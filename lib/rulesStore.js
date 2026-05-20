const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_PATH = path.join(DATA_DIR, "rulesState.json");

function ensureStateFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STATE_PATH)) {
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify({ eventsByGuild: {} }, null, 2),
      "utf8"
    );
  }
}

function loadState() {
  ensureStateFile();

  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return { eventsByGuild: {} };
    }

    if (!parsed.eventsByGuild || typeof parsed.eventsByGuild !== "object") {
      parsed.eventsByGuild = {};
    }

    return parsed;
  } catch (err) {
    console.error("[RULES] Failed reading rules state:", err);
    return { eventsByGuild: {} };
  }
}

function saveState(state) {
  ensureStateFile();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function getGuildEvents(state, guildId) {
  if (!state.eventsByGuild[guildId]) {
    state.eventsByGuild[guildId] = {};
  }

  return state.eventsByGuild[guildId];
}

function getEvent(guildId, key) {
  const state = loadState();
  const guildEvents = getGuildEvents(state, guildId);
  return guildEvents[key] || null;
}

function setEvent(guildId, key, eventData) {
  const state = loadState();
  const guildEvents = getGuildEvents(state, guildId);

  guildEvents[key] = {
    ...guildEvents[key],
    ...eventData,
    updatedAt: new Date().toISOString()
  };

  saveState(state);
  return guildEvents[key];
}

module.exports = {
  STATE_PATH,
  getEvent,
  setEvent
};
