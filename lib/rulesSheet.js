const { getSheets } = require("./sheets");
const { formatListInput } = require("./rulesTemplate");

const SHEET_NAME = "Rules";
const PRESET_RANGE = `${SHEET_NAME}!A2:O`;
const COLUMN_COUNT = 15;

/**
 * Row 1 headers:
 * A Key | B Name | C Guild ID | D Mode | E Event Type | F Stream Title
 * G Extra Bans | H Per Game Rules | I No Dropmap | J Separate Dropmaps
 * K Dropmap Note | L Penalty 1 | M Penalty 2 | N Penalty 3 | O Updated At
 */

const COL = {
  KEY: 0,
  NAME: 1,
  GUILD_ID: 2,
  MODE: 3,
  EVENT_TYPE: 4,
  STREAM_TITLE: 5,
  EXTRA_BANS: 6,
  PER_GAME_RULES: 7,
  NO_DROPMAP: 8,
  SEPARATE_DROPMAPS: 9,
  DROPMAP_NOTE: 10,
  PENALTY_1: 11,
  PENALTY_2: 12,
  PENALTY_3: 13,
  UPDATED_AT: 14
};

function getSpreadsheetId() {
  const sheetId = process.env.MAIN_SHEET_ID;

  if (!sheetId) {
    throw new Error("MAIN_SHEET_ID is not configured");
  }

  return sheetId;
}

function padRow(row) {
  const padded = [...row];

  while (padded.length < COLUMN_COUNT) {
    padded.push("");
  }

  return padded.slice(0, COLUMN_COUNT);
}

function parseListCell(value) {
  if (!value?.trim()) {
    return [];
  }

  return value
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);
}

function parseYesNo(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "yes";
}

function toYesNo(value) {
  return value ? "YES" : "NO";
}

function rowToPreset(row) {
  const padded = padRow(row);

  return {
    key: padded[COL.KEY],
    name: padded[COL.NAME] || padded[COL.KEY],
    guildId: padded[COL.GUILD_ID],
    mode: padded[COL.MODE],
    eventType: padded[COL.EVENT_TYPE] || "standard",
    streamTitle: padded[COL.STREAM_TITLE] || "",
    extraBans: parseListCell(padded[COL.EXTRA_BANS]),
    perGameRules: parseListCell(padded[COL.PER_GAME_RULES]),
    dropmapEnabled: !parseYesNo(padded[COL.NO_DROPMAP]),
    separateDropmaps: parseYesNo(padded[COL.SEPARATE_DROPMAPS]),
    dropmapExtraLine: padded[COL.DROPMAP_NOTE] || "",
    firstPenalty: Number(padded[COL.PENALTY_1]) || 20,
    secondPenalty: Number(padded[COL.PENALTY_2]) || 40,
    thirdPenaltyText: padded[COL.PENALTY_3] || "Disqualification",
    updatedAt: padded[COL.UPDATED_AT] || ""
  };
}

function presetToRow(preset) {
  return padRow([
    preset.key,
    preset.name || preset.key,
    preset.guildId,
    preset.mode,
    preset.eventType || "standard",
    preset.streamTitle || "",
    formatListInput(preset.extraBans),
    formatListInput(preset.perGameRules),
    toYesNo(preset.dropmapEnabled === false),
    toYesNo(!!preset.separateDropmaps),
    preset.dropmapExtraLine || "",
    preset.firstPenalty ?? 20,
    preset.secondPenalty ?? 40,
    preset.thirdPenaltyText || "Disqualification",
    preset.updatedAt || new Date().toISOString()
  ]);
}

async function getPresetRows() {
  try {
    const res = await getSheets().spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: PRESET_RANGE
    });

    return res.data.values || [];
  } catch (err) {
    console.error("[RULES SHEET] getPresetRows:", err);
    throw err;
  }
}

async function writePresetRows(rows) {
  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();
  const values = rows.map(row => presetToRow(rowToPreset(row)));

  if (!values.length) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: PRESET_RANGE
    });
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: PRESET_RANGE,
    valueInputOption: "RAW",
    requestBody: { values }
  });
}

async function listPresets(guildId) {
  const rows = await getPresetRows();

  return rows
    .map(rowToPreset)
    .filter(preset => preset.key && preset.guildId === guildId)
    .sort((a, b) => (a.name || a.key).localeCompare(b.name || b.key));
}

async function getPreset(guildId, key) {
  const rows = await getPresetRows();

  for (const row of rows) {
    const preset = rowToPreset(row);

    if (preset.guildId === guildId && preset.key === key) {
      return preset;
    }
  }

  return null;
}

async function setPreset(guildId, key, presetData) {
  const rows = await getPresetRows();
  const updatedAt = new Date().toISOString();
  const nextPreset = {
    ...presetData,
    key,
    guildId,
    updatedAt
  };
  const nextRow = presetToRow(nextPreset);

  let found = false;
  const nextRows = rows.map(row => {
    const preset = rowToPreset(row);

    if (preset.guildId === guildId && preset.key === key) {
      found = true;
      return nextRow;
    }

    return padRow(row);
  });

  if (!found) {
    nextRows.push(nextRow);
  }

  await writePresetRows(nextRows);
  return nextPreset;
}

async function deletePreset(guildId, key) {
  const rows = await getPresetRows();
  const nextRows = rows.filter(row => {
    const preset = rowToPreset(row);
    return !(preset.guildId === guildId && preset.key === key);
  });

  if (nextRows.length === rows.length) {
    return false;
  }

  await writePresetRows(nextRows);
  return true;
}

module.exports = {
  SHEET_NAME,
  PRESET_RANGE,
  listPresets,
  getPreset,
  setPreset,
  deletePreset
};
