const axios = require("axios");
const {
  getApiBaseUrl,
  getDiscordApiKey,
  getDiscordApiHeaders
} = require("./discordApi");

const YUNITE_PLAYED_PATH =
  process.env.DISCORD_YUNITE_PLAYED_PATH || "/api/discord/yunite-played";
const BATCH_SIZE = Number(process.env.YUNITE_PLAYED_BATCH_SIZE || 200);
const REQUEST_TIMEOUT_MS = 60_000;

function websiteApiConfigured() {
  return Boolean(getDiscordApiKey());
}

function emptySnapshot(reason) {
  return {
    loaded: false,
    reason,
    byDiscordId: new Map(),
    apiConfigured: websiteApiConfigured()
  };
}

function chunk(items, size) {
  const batches = [];

  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }

  return batches;
}

async function fetchYunitePlayedBatch(discordIds) {
  const apiKey = getDiscordApiKey();

  if (!apiKey) {
    throw new Error("DISCORD_SYNC_API_KEY is not configured");
  }

  const url = `${getApiBaseUrl()}${YUNITE_PLAYED_PATH}`;
  const res = await axios.post(
    url,
    { discordIds },
    {
      headers: getDiscordApiHeaders(),
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: status => status < 500
    }
  );

  if (res.status === 401 || res.status === 403) {
    throw new Error(`yunite-played unauthorized (${res.status})`);
  }

  if (res.status !== 200) {
    throw new Error(
      `yunite-played failed (${res.status}): ${JSON.stringify(res.data)}`
    );
  }

  const members = res.data?.members;
  return Array.isArray(members) ? members : [];
}

async function loadYuniteSnapshot(discordIds) {
  if (!websiteApiConfigured()) {
    return emptySnapshot("missing_api_key");
  }

  const uniqueIds = [...new Set(discordIds.map(String).filter(Boolean))];
  const byDiscordId = new Map();

  try {
    for (const batch of chunk(uniqueIds, Math.max(1, BATCH_SIZE))) {
      const members = await fetchYunitePlayedBatch(batch);

      for (const member of members) {
        const discordId = String(member?.discordId || "").trim();

        if (!discordId) {
          continue;
        }

        byDiscordId.set(discordId, {
          played: Boolean(member.played),
          eventsPlayedCount: Number(member.eventsPlayedCount || 0),
          epicId: String(member.epicId || ""),
          epicName: String(member.epicName || ""),
          match: member.match === "player" || member.match === "result"
            ? member.match
            : "none"
        });
      }
    }

    for (const id of uniqueIds) {
      if (!byDiscordId.has(id)) {
        byDiscordId.set(id, {
          played: false,
          eventsPlayedCount: 0,
          epicId: "",
          epicName: "",
          match: "none"
        });
      }
    }

    return {
      loaded: true,
      reason: "",
      byDiscordId,
      apiConfigured: true
    };
  } catch (err) {
    console.error("[PRUNE] Website Yunite lookup failed:", err?.message || err);
    return emptySnapshot(err?.message || "website_yunite_request_failed");
  }
}

function getTournamentStatus(discordId, snapshot) {
  const id = String(discordId || "");
  const row = snapshot.byDiscordId.get(id);

  if (!snapshot.loaded) {
    return {
      status: "unknown",
      match: "unavailable",
      reason: snapshot.reason || "Website Yunite data unavailable",
      epicId: row?.epicId || "",
      epicName: row?.epicName || ""
    };
  }

  if (row?.played) {
    const count = row.eventsPlayedCount || 1;
    return {
      status: "played",
      match: "confirmed",
      reason:
        count === 1
          ? "Appeared in website Yunite scrim data"
          : `Appeared in website Yunite scrim data (${count} events)`,
      epicId: row.epicId || "",
      epicName: row.epicName || ""
    };
  }

  return {
    status: "never_played",
    match: row?.match === "player" ? "confirmed" : "unmatched",
    reason: "Website Yunite data has no scrim appearances",
    epicId: row?.epicId || "",
    epicName: row?.epicName || ""
  };
}

module.exports = {
  YUNITE_PLAYED_PATH,
  websiteApiConfigured,
  loadYuniteSnapshot,
  getTournamentStatus
};
