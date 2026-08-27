const axios = require("axios");
const { getSheets } = require("./sheets");

const GUILD_ID = process.env.GUILD_ID || "1371615693392576580";
const YUNITE_BASE = "https://yunite.xyz/api/v3";
const CACHE_TTL_MS = Number(process.env.YUNITE_PRUNE_CACHE_TTL_MS || 10 * 60 * 1000);
const LINK_BATCH_SIZE = Number(process.env.YUNITE_LINK_BATCH_SIZE || 80);
const LEADERBOARD_CONCURRENCY = Number(
  process.env.YUNITE_LEADERBOARD_CONCURRENCY || 2
);
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_MAX = 3;

let participantCache = null;
let participantCacheLoadedAt = 0;
let participantLoadPromise = null;
const linksByDiscordId = new Map();
let linksCachedAt = 0;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function getYuniteApiKey() {
  return process.env.YUNITE_API_KEY || "";
}

function isDiscordSnowflake(value) {
  return /^\d{17,20}$/.test(String(value || "").trim());
}

function normalizeEpicId(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const compact = /^[0-9a-f]{32}$/i;

  if (uuid.test(raw) || compact.test(raw)) {
    return raw.toLowerCase();
  }

  return "";
}

function addEpicId(set, value) {
  const id = normalizeEpicId(value);

  if (id) {
    set.add(id);
    set.add(id.replace(/-/g, ""));
  }
}

function unwrapList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  for (const key of ["data", "tournaments", "teams", "users", "links", "result", "leaderboard"]) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }

    if (payload[key] && typeof payload[key] === "object" && !Array.isArray(payload[key])) {
      const values = Object.values(payload[key]);
      if (values.length && values.every(value => value && typeof value === "object")) {
        return values.map((value, index) => {
          const idKey = Object.keys(payload[key])[index];
          if (value.discordId || value.epicId || value.id) {
            return value;
          }
          return { ...value, id: value.id || idKey };
        });
      }
    }
  }

  const values = Object.values(payload);
  if (
    values.length &&
    values.every(value => value && typeof value === "object" && !Array.isArray(value))
  ) {
    return values;
  }

  return [];
}

function tournamentIdFrom(entry) {
  if (entry == null) {
    return "";
  }

  if (typeof entry === "string" || typeof entry === "number") {
    return String(entry).trim();
  }

  return String(
    entry.id ||
      entry.tournamentId ||
      entry.tournament_id ||
      entry._id ||
      ""
  ).trim();
}

function collectFromUserObject(user, playedDiscordIds, playedEpicIds) {
  if (!user || typeof user !== "object") {
    return;
  }

  const epicId =
    user.epicId ||
    user.epic_id ||
    user.userEpicId ||
    user.epicAccountId ||
    user.accountId;

  addEpicId(playedEpicIds, epicId);

  const discordCandidates = [
    user.discordId,
    user.discord_id,
    user.discordUserId,
    user.userId,
    user.user_id,
    user.id
  ];

  for (const candidate of discordCandidates) {
    if (isDiscordSnowflake(candidate) && !normalizeEpicId(candidate)) {
      playedDiscordIds.add(String(candidate).trim());
    }
  }
}

function collectParticipantsFromLeaderboard(payload, playedDiscordIds, playedEpicIds) {
  const teams = unwrapList(payload);

  for (const team of teams) {
    const users = Array.isArray(team?.users)
      ? team.users
      : Array.isArray(team?.players)
        ? team.players
        : Array.isArray(team?.members)
          ? team.members
          : [];

    for (const user of users) {
      collectFromUserObject(user, playedDiscordIds, playedEpicIds);
    }

    collectFromUserObject(team, playedDiscordIds, playedEpicIds);
  }

  if (Array.isArray(payload?.users)) {
    for (const user of payload.users) {
      collectFromUserObject(user, playedDiscordIds, playedEpicIds);
    }
  }
}

function parseLinkRecord(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const discordObj =
    (entry.discord && typeof entry.discord === "object" && entry.discord) ||
    (entry.user && typeof entry.user === "object" && entry.user) ||
    {};
  const epicObj =
    (entry.epic && typeof entry.epic === "object" && entry.epic) ||
    (entry.epicAccount && typeof entry.epicAccount === "object" && entry.epicAccount) ||
    {};

  const discordId = [
    entry.discordId,
    entry.discord_id,
    entry.userId,
    entry.user_id,
    discordObj.id,
    discordObj.discordId,
    entry.id
  ].find(value => isDiscordSnowflake(value) && !normalizeEpicId(value));

  const epicId = normalizeEpicId(
    entry.epicId ||
      entry.epic_id ||
      entry.accountId ||
      epicObj.epicId ||
      epicObj.id ||
      epicObj.accountId
  );

  const epicName = String(
    entry.epicName ||
      entry.name ||
      entry.displayName ||
      epicObj.name ||
      epicObj.displayName ||
      ""
  ).trim();

  if (!discordId && !epicId) {
    return null;
  }

  return {
    discordId: discordId ? String(discordId) : "",
    epicId,
    epicName
  };
}

async function yuniteRequest(method, path, body) {
  const apiKey = getYuniteApiKey();

  if (!apiKey) {
    throw new Error("YUNITE_API_KEY is not configured");
  }

  let lastError;

  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    try {
      const res = await axios({
        method,
        url: `${YUNITE_BASE}/guild/${GUILD_ID}${path}`,
        data: body,
        headers: {
          "Y-Api-Token": apiKey,
          "Content-Type": "application/json"
        },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: status => status < 500
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers?.["retry-after"] || 2);
        await delay(Math.max(500, retryAfter * 1000));
        continue;
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error(`Yunite unauthorized (${res.status})`);
      }

      if (res.status >= 400) {
        throw new Error(
          `Yunite ${method.toUpperCase()} ${path} failed (${res.status})`
        );
      }

      return res.data;
    } catch (err) {
      lastError = err;

      const status = err?.response?.status;
      const retryable =
        status === 429 ||
        (typeof status === "number" && status >= 500) ||
        !status;

      if (!retryable || attempt === RETRY_MAX) {
        throw err;
      }

      await delay(500 * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) || 0 },
    worker
  );

  await Promise.all(workers);
  return results;
}

async function loadPlayerScoreEpicIds() {
  const spreadsheetId =
    process.env.SUBMIT_SHEET_ID || process.env.MAIN_SHEET_ID;
  const playedEpicIds = new Set();

  if (!spreadsheetId || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    return playedEpicIds;
  }

  try {
    const res = await getSheets().spreadsheets.values.get({
      spreadsheetId,
      range: "Player_Scores!A3:B"
    });

    for (const row of res.data.values || []) {
      addEpicId(playedEpicIds, row?.[1]);
    }
  } catch (err) {
    console.warn(
      "[PRUNE] Player_Scores sheet not loaded:",
      err?.message || err
    );
  }

  return playedEpicIds;
}

async function fetchTournamentIds() {
  const payload = await yuniteRequest("get", "/tournaments");
  const list = unwrapList(payload);
  const ids = [];

  for (const entry of list) {
    const id = tournamentIdFrom(entry);

    if (id) {
      ids.push(id);
    }
  }

  return [...new Set(ids)];
}

async function fetchLeaderboardParticipants(tournamentIds) {
  const playedDiscordIds = new Set();
  const playedEpicIds = new Set();
  let failed = 0;

  await mapPool(tournamentIds, LEADERBOARD_CONCURRENCY, async tournamentId => {
    try {
      const payload = await yuniteRequest(
        "get",
        `/tournaments/${tournamentId}/leaderboard`
      );
      collectParticipantsFromLeaderboard(
        payload,
        playedDiscordIds,
        playedEpicIds
      );
    } catch (err) {
      failed++;
      console.error(
        `[PRUNE] Yunite leaderboard failed for ${tournamentId}:`,
        err?.message || err
      );
    }

    await delay(250);
  });

  return { playedDiscordIds, playedEpicIds, failed };
}

async function fetchRegistrationLinks(discordIds) {
  const linksByDiscordId = new Map();
  let failedBatches = 0;

  for (let i = 0; i < discordIds.length; i += LINK_BATCH_SIZE) {
    const batch = discordIds.slice(i, i + LINK_BATCH_SIZE);

    try {
      const payload = await yuniteRequest("post", "/registration/links", {
        type: "DISCORD",
        userIds: batch
      });

      for (const entry of unwrapList(payload)) {
        const parsed = parseLinkRecord(entry);

        if (parsed?.discordId) {
          linksByDiscordId.set(parsed.discordId, parsed);
        }
      }
    } catch (err) {
      failedBatches++;
      console.error(
        `[PRUNE] Yunite registration links batch failed (${i}-${i + batch.length}):`,
        err?.message || err
      );
    }

    await delay(200);
  }

  return { linksByDiscordId, failedBatches };
}

function emptySnapshot(reason) {
  return {
    loaded: false,
    reason,
    tournamentCount: 0,
    leaderboardFailures: 0,
    linkBatchFailures: 0,
    playedDiscordIds: new Set(),
    playedEpicIds: new Set(),
    linksByDiscordId,
    tournamentsFullyChecked: false
  };
}

async function loadParticipantSnapshot() {
  const now = Date.now();

  if (
    participantCache &&
    now - participantCacheLoadedAt < CACHE_TTL_MS
  ) {
    return participantCache;
  }

  if (participantLoadPromise) {
    return participantLoadPromise;
  }

  participantLoadPromise = (async () => {
    if (!getYuniteApiKey()) {
      participantCache = emptySnapshot("missing_api_key");
      participantCacheLoadedAt = Date.now();
      return participantCache;
    }

    try {
      const tournamentIds = await fetchTournamentIds();
      const leaderboards = await fetchLeaderboardParticipants(tournamentIds);
      const sheetEpicIds = await loadPlayerScoreEpicIds();
      const playedEpicIds = new Set([
        ...leaderboards.playedEpicIds,
        ...sheetEpicIds
      ]);

      participantCache = {
        loaded: true,
        reason: "",
        tournamentCount: tournamentIds.length,
        leaderboardFailures: leaderboards.failed,
        linkBatchFailures: 0,
        playedDiscordIds: leaderboards.playedDiscordIds,
        playedEpicIds,
        linksByDiscordId,
        tournamentsFullyChecked:
          tournamentIds.length > 0 && leaderboards.failed === 0
      };

      if (tournamentIds.length === 0) {
        participantCache.loaded = false;
        participantCache.reason = "no_tournaments";
        participantCache.tournamentsFullyChecked = false;
      } else if (leaderboards.failed > 0) {
        participantCache.tournamentsFullyChecked = false;
        participantCache.reason = "leaderboard_partial_failure";
      }

      participantCacheLoadedAt = Date.now();
      return participantCache;
    } catch (err) {
      console.error("[PRUNE] Yunite snapshot failed:", err?.message || err);
      participantCache = emptySnapshot(err?.message || "yunite_request_failed");
      participantCacheLoadedAt = Date.now();
      return participantCache;
    }
  })();

  try {
    return await participantLoadPromise;
  } finally {
    participantLoadPromise = null;
  }
}

async function loadYuniteSnapshot(discordIds) {
  const snapshot = await loadParticipantSnapshot();
  const now = Date.now();

  if (now - linksCachedAt > CACHE_TTL_MS) {
    linksByDiscordId.clear();
    linksCachedAt = now;
  }

  const missingIds = [...new Set(discordIds.map(String))].filter(
    id => !linksByDiscordId.has(id)
  );

  if (!snapshot.loaded || missingIds.length === 0 || !getYuniteApiKey()) {
    snapshot.linkBatchFailures = snapshot.linkBatchFailures || 0;
    snapshot.linksByDiscordId = linksByDiscordId;
    return snapshot;
  }

  const links = await fetchRegistrationLinks(missingIds);
  snapshot.linkBatchFailures = links.failedBatches;

  for (const [discordId, link] of links.linksByDiscordId.entries()) {
    linksByDiscordId.set(discordId, link);
  }

  // Remember unsuccessful lookups so we do not refetch every scan.
  for (const id of missingIds) {
    if (!linksByDiscordId.has(id) && links.failedBatches === 0) {
      linksByDiscordId.set(id, { discordId: id, epicId: "", epicName: "" });
    }
  }

  snapshot.linksByDiscordId = linksByDiscordId;
  return snapshot;
}

function epicPlayed(snapshot, epicId) {
  if (!epicId) {
    return false;
  }

  const normalized = epicId.toLowerCase();
  return (
    snapshot.playedEpicIds.has(normalized) ||
    snapshot.playedEpicIds.has(normalized.replace(/-/g, ""))
  );
}

/**
 * played / never_played / unknown
 * Failed or missing matches are always unknown.
 */
function getTournamentStatus(discordId, snapshot) {
  const id = String(discordId || "");

  if (snapshot.playedDiscordIds.has(id)) {
    const link = snapshot.linksByDiscordId.get(id);
    return {
      status: "played",
      match: "confirmed",
      reason: "Appeared in a ZBD Yunite tournament result",
      epicId: link?.epicId || "",
      epicName: link?.epicName || ""
    };
  }

  const link = snapshot.linksByDiscordId.get(id);

  if (!snapshot.loaded) {
    return {
      status: "unknown",
      match: "unavailable",
      reason: snapshot.reason || "Tournament data unavailable",
      epicId: link?.epicId || "",
      epicName: link?.epicName || ""
    };
  }

  if (!link?.epicId) {
    return {
      status: "unknown",
      match: "unmatched",
      reason: "No reliable Discord → Epic/Yunite match",
      epicId: "",
      epicName: link?.epicName || ""
    };
  }

  if (epicPlayed(snapshot, link.epicId)) {
    return {
      status: "played",
      match: "confirmed",
      reason: "Linked Epic account appeared in a ZBD event",
      epicId: link.epicId,
      epicName: link.epicName || ""
    };
  }

  if (!snapshot.tournamentsFullyChecked) {
    return {
      status: "unknown",
      match: "confirmed",
      reason: "Yunite tournament list could not be fully checked",
      epicId: link.epicId || "",
      epicName: link.epicName || ""
    };
  }

  return {
    status: "never_played",
    match: "confirmed",
    reason: "Linked Yunite account has no ZBD event appearances",
    epicId: link.epicId,
    epicName: link.epicName || ""
  };
}

module.exports = {
  getYuniteApiKey,
  loadYuniteSnapshot,
  getTournamentStatus
};
