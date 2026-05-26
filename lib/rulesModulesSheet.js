const { getSheets } = require("./sheets");
const { normalizeGuildId } = require("./rulesSheet");

const SHEET_NAME = "Rules Modules";
const MODULE_RANGE = `${SHEET_NAME}!A2:E`;
const HEADER_RANGE = `${SHEET_NAME}!A1:E1`;
const COLUMN_COUNT = 5;
const CACHE_MS = 60_000;

const MODULE_HEADERS = [
  "Module",
  "Guild ID",
  "Game",
  "Content",
  "Updated At"
];

const COL = {
  MODULE: 0,
  GUILD_ID: 1,
  GAME: 2,
  CONTENT: 3,
  UPDATED_AT: 4
};

/** @type {Map<string, { fetchedAt: number, modules: Record<string, string> }>} */
const moduleCache = new Map();

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

function normalizeModuleKey(raw) {
  return (raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_ ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 64);
}

function normalizeGameKey(raw) {
  const value = (raw || "").toLowerCase().trim();

  if (!value || value === "all" || value === "*") {
    return "";
  }

  return value;
}

function isHeaderRow(padded) {
  return String(padded[COL.MODULE] || "")
    .trim()
    .toLowerCase() === "module";
}

function rowToModuleRow(row) {
  const padded = padRow(row);

  if (isHeaderRow(padded)) {
    return null;
  }

  const moduleKey = normalizeModuleKey(padded[COL.MODULE]);

  if (!moduleKey) {
    return null;
  }

  return {
    moduleKey,
    guildId: normalizeGuildId(padded[COL.GUILD_ID]),
    gameKey: normalizeGameKey(padded[COL.GAME]),
    content: String(padded[COL.CONTENT] || ""),
    updatedAt: padded[COL.UPDATED_AT] || ""
  };
}

function presetMatchesGuild(row, guildId) {
  return normalizeGuildId(row.guildId) === normalizeGuildId(guildId);
}

async function getSheetIdByTitle(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(
    entry => entry.properties?.title === title
  );

  return sheet?.properties?.sheetId ?? null;
}

async function ensureRulesModulesSheet() {
  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();
  let sheetId = await getSheetIdByTitle(sheets, spreadsheetId, SHEET_NAME);

  if (!sheetId) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_NAME } } }]
      }
    });

    sheetId = created.data.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
  }

  const headerCheck = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`
  });
  const firstCell = headerCheck.data.values?.[0]?.[0]?.trim() || "";

  if (firstCell.toLowerCase() === "module") {
    return;
  }

  if (firstCell && sheetId) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            insertDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: 0,
                endIndex: 1
              },
              inheritFromBefore: false
            }
          }
        ]
      }
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: HEADER_RANGE,
    valueInputOption: "RAW",
    requestBody: { values: [MODULE_HEADERS] }
  });
}

async function getModuleRows() {
  await ensureRulesModulesSheet();

  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: MODULE_RANGE
  });

  return res.data.values || [];
}

function mergeModuleRows(rows, guildId, gameKey) {
  const targetGame = normalizeGameKey(gameKey);
  const global = {};
  const gameSpecific = {};

  for (const row of rows) {
    const entry = rowToModuleRow(row);

    if (!entry || !presetMatchesGuild(entry, guildId)) {
      continue;
    }

    if (!entry.gameKey) {
      global[entry.moduleKey] = entry.content;
      continue;
    }

    if (entry.gameKey === targetGame) {
      gameSpecific[entry.moduleKey] = entry.content;
    }
  }

  return { ...global, ...gameSpecific };
}

async function getRulesModules(guildId, gameKey, { force = false } = {}) {
  const cacheKey = `${normalizeGuildId(guildId)}:${normalizeGameKey(gameKey)}`;

  if (!force) {
    const cached = moduleCache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < CACHE_MS) {
      return cached.modules;
    }
  }

  const rows = await getModuleRows();
  const modules = mergeModuleRows(rows, guildId, gameKey);

  moduleCache.set(cacheKey, {
    fetchedAt: Date.now(),
    modules
  });

  return modules;
}

function clearRulesModulesCache(guildId) {
  if (!guildId) {
    moduleCache.clear();
    return;
  }

  const prefix = `${normalizeGuildId(guildId)}:`;

  for (const key of moduleCache.keys()) {
    if (key.startsWith(prefix)) {
      moduleCache.delete(key);
    }
  }
}

module.exports = {
  SHEET_NAME,
  MODULE_HEADERS,
  ensureRulesModulesSheet,
  getRulesModules,
  clearRulesModulesCache,
  normalizeModuleKey
};
