const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");
const { getSheets } = require("./sheets");

const SHEET_NAME = "Rules Library";
const RANGE = `${SHEET_NAME}!A2:D`;
const HEADER_RANGE = `${SHEET_NAME}!A1:D1`;

const RULES_LIBRARY_HEADERS = ["Guild ID", "Type", "Value", "Updated At"];

const COL = {
  GUILD_ID: 0,
  TYPE: 1,
  VALUE: 2,
  UPDATED_AT: 3
};

const TYPES = {
  BAN: "ban",
  RULE: "rule"
};

function getSpreadsheetId() {
  const sheetId = process.env.MAIN_SHEET_ID;

  if (!sheetId) {
    throw new Error("MAIN_SHEET_ID is not configured");
  }

  return sheetId;
}

function normalizeValue(value) {
  return (value || "").trim();
}

function padRow(row) {
  const padded = [...row];

  while (padded.length < 4) {
    padded.push("");
  }

  return padded.slice(0, 4);
}

function rowToEntry(row) {
  const padded = padRow(row);

  return {
    guildId: padded[COL.GUILD_ID],
    type: (padded[COL.TYPE] || "").trim().toLowerCase(),
    value: normalizeValue(padded[COL.VALUE]),
    updatedAt: padded[COL.UPDATED_AT] || ""
  };
}

async function getRows() {
  try {
    await ensureRulesLibrarySheet();

    const res = await getSheets().spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: RANGE
    });

    return res.data.values || [];
  } catch (err) {
    if (err?.message?.includes("Unable to parse range")) {
      return [];
    }

    console.error("[RULES LIBRARY] getRows:", err);
    throw err;
  }
}

async function getSheetIdByTitle(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(
    entry => entry.properties?.title === title
  );

  return sheet?.properties?.sheetId ?? null;
}

async function ensureRulesLibrarySheet() {
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

  if (firstCell.toLowerCase() === "guild id") {
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
    requestBody: { values: [RULES_LIBRARY_HEADERS] }
  });
}

async function writeRows(entries) {
  await ensureRulesLibrarySheet();

  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();
  const values = entries.map(entry =>
    padRow([
      entry.guildId,
      entry.type,
      entry.value,
      entry.updatedAt || new Date().toISOString()
    ])
  );

  if (!values.length) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: RANGE
    });
    return;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: RANGE,
    valueInputOption: "RAW",
    requestBody: { values }
  });
}

async function listSuggestions(guildId, type) {
  const rows = await getRows();
  const targetType = (type || "").toLowerCase();

  return rows
    .map(rowToEntry)
    .filter(
      entry =>
        entry.guildId === guildId &&
        entry.type === targetType &&
        entry.value
    )
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .map(entry => entry.value);
}

async function addSuggestions(guildId, type, items) {
  const targetType = (type || "").toLowerCase();
  const incoming = (Array.isArray(items) ? items : [])
    .map(normalizeValue)
    .filter(Boolean);

  if (!incoming.length) {
    return [];
  }

  const rows = await getRows();
  const existing = rows.map(rowToEntry);
  const now = new Date().toISOString();
  const seen = new Set();

  const merged = [];

  for (const item of incoming) {
    const key = item.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.unshift({
      guildId,
      type: targetType,
      value: item,
      updatedAt: now
    });
  }

  for (const entry of existing) {
    if (entry.guildId !== guildId || entry.type !== targetType || !entry.value) {
      merged.push(entry);
      continue;
    }

    const key = entry.value.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(entry);
  }

  await writeRows(merged);

  return merged
    .filter(entry => entry.guildId === guildId && entry.type === targetType)
    .map(entry => entry.value);
}

async function rememberRulesSuggestions(guildId, { bans = [], rules = [] } = {}) {
  try {
    if (bans.length) {
      await addSuggestions(guildId, TYPES.BAN, bans);
    }

    if (rules.length) {
      await addSuggestions(guildId, TYPES.RULE, rules);
    }
  } catch (err) {
    console.error("[RULES LIBRARY] remember:", err?.message || err);
  }
}

function suggestionKey(value) {
  return (value || "").trim().toLowerCase();
}

function filterSuggestionsNotInList(suggestions, currentItems) {
  const onList = new Set(
    (Array.isArray(currentItems) ? currentItems : []).map(suggestionKey)
  );

  return (Array.isArray(suggestions) ? suggestions : []).filter(item => {
    const key = suggestionKey(item);
    return key && !onList.has(key);
  });
}

function truncateLabel(text, max = 100) {
  const value = (text || "").trim();

  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1)}…`;
}

function buildSuggestionSelectRow({ customId, placeholder, items }) {
  if (!items?.length) {
    return null;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder);

  const options = items.slice(0, 25).map((item, index) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(truncateLabel(item))
      .setValue(String(index))
      .setDescription("Recent")
  );

  menu.addOptions(options);

  return {
    row: new ActionRowBuilder().addComponents(menu),
    cache: items.slice(0, 25)
  };
}

module.exports = {
  SHEET_NAME,
  TYPES,
  ensureRulesLibrarySheet,
  listSuggestions,
  addSuggestions,
  rememberRulesSuggestions,
  filterSuggestionsNotInList,
  buildSuggestionSelectRow
};
