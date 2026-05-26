const fs = require("fs");
const path = require("path");

const STATE_PATH =
  process.env.ROLE_SYNC_STATE_PATH ||
  path.join(__dirname, "..", "data", "role-sync-state.json");

const MAX_IDS = Number(process.env.ROLE_SYNC_STATE_MAX_IDS || 20_000);

let state = { adds: {}, removals: {} };
let loaded = false;
let saveTimer = null;

function ensureLoaded() {
  if (loaded) {
    return;
  }

  loaded = true;

  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
      state = {
        adds: raw.adds && typeof raw.adds === "object" ? raw.adds : {},
        removals:
          raw.removals && typeof raw.removals === "object"
            ? raw.removals
            : {}
      };
    }
  } catch (err) {
    console.error("[ROLE SYNC STATE] load failed:", err?.message || err);
    state = { adds: {}, removals: {} };
  }

  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  } catch {
    // ignore
  }
}

function trimMap(map) {
  const keys = Object.keys(map);

  if (keys.length <= MAX_IDS) {
    return map;
  }

  const sorted = keys.sort((a, b) => (map[a] || 0) - (map[b] || 0));
  const out = {};

  for (const key of sorted.slice(-MAX_IDS)) {
    out[key] = map[key];
  }

  return out;
}

function scheduleSave() {
  if (saveTimer) {
    return;
  }

  saveTimer = setTimeout(() => {
    saveTimer = null;

    try {
      state.adds = trimMap(state.adds);
      state.removals = trimMap(state.removals);
      fs.writeFileSync(STATE_PATH, JSON.stringify(state));
    } catch (err) {
      console.error("[ROLE SYNC STATE] save failed:", err?.message || err);
    }
  }, 500);
}

function hasProcessedAdd(banId) {
  ensureLoaded();
  return Boolean(state.adds[banId]);
}

function hasProcessedRemoval(banId) {
  ensureLoaded();
  return Boolean(state.removals[banId]);
}

function markProcessedAdd(banId) {
  if (!banId) {
    return;
  }

  ensureLoaded();
  state.adds[banId] = Date.now();
  scheduleSave();
}

function markProcessedRemoval(banId) {
  if (!banId) {
    return;
  }

  ensureLoaded();
  state.removals[banId] = Date.now();
  scheduleSave();
}

module.exports = {
  STATE_PATH,
  hasProcessedAdd,
  hasProcessedRemoval,
  markProcessedAdd,
  markProcessedRemoval
};
