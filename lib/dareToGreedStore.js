const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_PATH =
  process.env.DARE_TO_GREED_STATE_PATH ||
  path.join(DATA_DIR, "dareToGreed.json");

const CHOICES = Object.freeze({
  SAFE: "Safe",
  GREEDY: "Greedy"
});

const SUPPORTED_GAMES = [1, 2, 3, 4];

let writeQueue = Promise.resolve();

function ensureStateFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STATE_PATH)) {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ guilds: {} }, null, 2), "utf8");
  }
}

function loadState() {
  ensureStateFile();

  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));

    if (!parsed || typeof parsed !== "object") {
      return { guilds: {} };
    }

    if (!parsed.guilds || typeof parsed.guilds !== "object") {
      parsed.guilds = {};
    }

    return parsed;
  } catch (err) {
    console.error("[DARE TO GREED] Failed reading state:", err?.message || err);
    return { guilds: {} };
  }
}

function saveState(state) {
  ensureStateFile();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function enqueueWrite(fn) {
  const run = writeQueue.then(fn, fn);

  writeQueue = run.catch(err => {
    if (err?.code !== "LOCKED" && err?.code !== "NO_CHALLENGE") {
      console.error("[DARE TO GREED] state write failed:", err?.message || err);
    }
  });

  return run;
}

function emptyGuildState() {
  return {
    captains: {},
    captainOrder: [],
    games: {}
  };
}

function emptyGameState() {
  const now = new Date().toISOString();

  return {
    locked: false,
    challengeText: "",
    channelId: "",
    messageId: "",
    roleId: "",
    selections: {},
    createdAt: now,
    updatedAt: now
  };
}

function normalizeGameNumber(value) {
  const game = Number(value);
  return SUPPORTED_GAMES.includes(game) ? game : null;
}

function getGuildState(state, guildId) {
  const id = String(guildId || "");

  if (!id) {
    return emptyGuildState();
  }

  if (!state.guilds[id]) {
    state.guilds[id] = emptyGuildState();
  }

  const guildState = state.guilds[id];

  if (!guildState.captains || typeof guildState.captains !== "object") {
    guildState.captains = {};
  }

  if (!Array.isArray(guildState.captainOrder)) {
    guildState.captainOrder = Object.keys(guildState.captains);
  }

  if (!guildState.games || typeof guildState.games !== "object") {
    guildState.games = {};
  }

  return guildState;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getGuildSnapshot(guildId) {
  const state = loadState();
  return clone(getGuildState(state, guildId));
}

function getGameSnapshot(guildId, gameNumber) {
  const game = normalizeGameNumber(gameNumber);

  if (!game) {
    return null;
  }

  const guildState = getGuildSnapshot(guildId);
  const record = guildState.games[String(game)];

  return record ? { game, ...clone(record) } : null;
}

function listCaptains(guildId) {
  const guildState = getGuildSnapshot(guildId);

  return guildState.captainOrder
    .map(userId => {
      const captain = guildState.captains[userId];

      if (!captain) {
        return null;
      }

      return {
        userId,
        displayName: captain.displayName || userId,
        rowNumber: captain.rowNumber || null
      };
    })
    .filter(Boolean);
}

function mutateGuild(guildId, mutator) {
  return enqueueWrite(() => {
    const state = loadState();
    const guildState = getGuildState(state, guildId);
    const result = mutator(guildState) || guildState;
    saveState(state);
    return result;
  });
}

function resetEvent(guildId) {
  return mutateGuild(guildId, guildState => {
    guildState.captains = {};
    guildState.captainOrder = [];
    guildState.games = {};
    return guildState;
  });
}

function setCaptains(guildId, captains) {
  return mutateGuild(guildId, guildState => {
    const nextCaptains = {};
    const nextOrder = [];
    const seen = new Set();

    for (const captain of captains || []) {
      const userId = String(captain.userId || "").trim();

      if (!userId || seen.has(userId)) {
        continue;
      }

      seen.add(userId);
      nextOrder.push(userId);
      nextCaptains[userId] = {
        displayName: String(captain.displayName || userId).trim() || userId,
        rowNumber: Number(captain.rowNumber) || null
      };
    }

    guildState.captains = nextCaptains;
    guildState.captainOrder = nextOrder;
    return guildState;
  });
}

function upsertGame(guildId, gameNumber, patch) {
  const game = normalizeGameNumber(gameNumber);

  if (!game) {
    throw new Error("Dare to Greed only supports games 1–4.");
  }

  return mutateGuild(guildId, guildState => {
    const key = String(game);
    const current = guildState.games[key] || emptyGameState();
    const now = new Date().toISOString();

    guildState.games[key] = {
      ...current,
      ...patch,
      selections:
        patch.selections && typeof patch.selections === "object"
          ? patch.selections
          : current.selections,
      createdAt: current.createdAt || now,
      updatedAt: now
    };

    return guildState.games[key];
  });
}

function setSelection(guildId, gameNumber, userId, choice) {
  const game = normalizeGameNumber(gameNumber);
  const id = String(userId || "").trim();

  if (!game) {
    throw new Error("Dare to Greed only supports games 1–4.");
  }

  if (!id) {
    throw new Error("Missing user id.");
  }

  if (choice !== CHOICES.SAFE && choice !== CHOICES.GREEDY) {
    throw new Error("Choice must be Safe or Greedy.");
  }

  return mutateGuild(guildId, guildState => {
    const key = String(game);
    const current = guildState.games[key];

    if (!current) {
      const err = new Error(`No Dare to Greed challenge is active for Game ${game}.`);
      err.code = "NO_CHALLENGE";
      throw err;
    }

    if (current.locked) {
      const err = new Error(`Game ${game} answers are locked.`);
      err.code = "LOCKED";
      throw err;
    }

    current.selections = {
      ...(current.selections || {}),
      [id]: choice
    };
    current.updatedAt = new Date().toISOString();
    guildState.games[key] = current;
    return {
      choice,
      game,
      locked: false
    };
  });
}

function finalizeAndLock(guildId, gameNumber, captainUserIds) {
  const game = normalizeGameNumber(gameNumber);

  if (!game) {
    throw new Error("Dare to Greed only supports games 1–4.");
  }

  return mutateGuild(guildId, guildState => {
    const key = String(game);
    const current = guildState.games[key];

    if (!current) {
      const err = new Error(`No Dare to Greed challenge is active for Game ${game}.`);
      err.code = "NO_CHALLENGE";
      throw err;
    }

    const selections = { ...(current.selections || {}) };

    for (const userId of captainUserIds || []) {
      if (!selections[userId]) {
        selections[userId] = CHOICES.SAFE;
      }
    }

    const alreadyLocked = Boolean(current.locked);

    current.locked = true;
    current.selections = selections;
    current.updatedAt = new Date().toISOString();
    guildState.games[key] = current;

    return {
      alreadyLocked,
      game,
      challengeText: current.challengeText,
      channelId: current.channelId,
      messageId: current.messageId,
      roleId: current.roleId || "",
      selections
    };
  });
}

function findUnlockedGames(guildId) {
  const guildState = getGuildSnapshot(guildId);

  return SUPPORTED_GAMES.filter(game => {
    const record = guildState.games[String(game)];
    return record && !record.locked;
  });
}

module.exports = {
  STATE_PATH,
  CHOICES,
  SUPPORTED_GAMES,
  normalizeGameNumber,
  getGuildSnapshot,
  getGameSnapshot,
  listCaptains,
  resetEvent,
  setCaptains,
  upsertGame,
  setSelection,
  finalizeAndLock,
  findUnlockedGames
};
