const { getSheets } = require("./sheets");

const SHEET_NAME = "Dashboard";
const RANGE = `${SHEET_NAME}!A2:N`;
const HEADER_RANGE = `${SHEET_NAME}!A1:N1`;

const DASHBOARD_HEADERS = [
  "Guild ID",
  "Dashboard Channel ID",
  "Dashboard Message ID",
  "Active Category ID",
  "Active Role ID",
  "Game Call Channel ID",
  "VOD Channel ID",
  "Voice Check Channel ID",
  "Unreg Channel ID",
  "Dropmap Check Channel ID",
  "Dropmap Closed Channel ID",
  "Channel Overrides JSON",
  "Config JSON",
  "Updated At"
];

const COL = {
  GUILD_ID: 0,
  DASHBOARD_CHANNEL_ID: 1,
  DASHBOARD_MESSAGE_ID: 2,
  ACTIVE_CATEGORY_ID: 3,
  ACTIVE_ROLE_ID: 4,
  GAME_CALL_CHANNEL_ID: 5,
  VOD_CHANNEL_ID: 6,
  VOICE_CHECK_CHANNEL_ID: 7,
  UNREG_CHANNEL_ID: 8,
  DROPMAP_CHECK_CHANNEL_ID: 9,
  DROPMAP_CLOSED_CHANNEL_ID: 10,
  CHANNEL_OVERRIDES_JSON: 11,
  CONFIG_JSON: 12,
  UPDATED_AT: 13
};

const COLUMN_COUNT = 14;
const DEFAULT_DASHBOARD_CHANNEL_ID = "1472795189515915466";

function getSpreadsheetId() {
  const sheetId = process.env.MAIN_SHEET_ID;

  if (!sheetId) {
    throw new Error("MAIN_SHEET_ID is not configured");
  }

  return sheetId;
}

function padRow(row) {
  const padded = [...(row || [])];

  while (padded.length < COLUMN_COUNT) {
    padded.push("");
  }

  return padded.slice(0, COLUMN_COUNT);
}

function parseJsonCell(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function dashboardToRow(record) {
  const now = new Date().toISOString();
  const resolvedChannels = record.resolvedChannels || {};

  return padRow([
    record.guildId || "",
    record.dashboardChannelId || DEFAULT_DASHBOARD_CHANNEL_ID,
    record.dashboardMessageId || "",
    record.activeCategoryId || "",
    record.activeRoleId || "",
    resolvedChannels.gamecall || "",
    resolvedChannels.vod || "",
    resolvedChannels.voicecheck || "",
    resolvedChannels.unreg || "",
    resolvedChannels.dropmapcheck || "",
    resolvedChannels.dropmapclosed || "",
    JSON.stringify(record.channelOverrides || {}),
    JSON.stringify(record.config || {}),
    record.updatedAt || now
  ]);
}

function rowToDashboard(row) {
  const padded = padRow(row);

  return {
    guildId: padded[COL.GUILD_ID] || "",
    dashboardChannelId:
      padded[COL.DASHBOARD_CHANNEL_ID] || DEFAULT_DASHBOARD_CHANNEL_ID,
    dashboardMessageId: padded[COL.DASHBOARD_MESSAGE_ID] || "",
    activeCategoryId: padded[COL.ACTIVE_CATEGORY_ID] || "",
    activeRoleId: padded[COL.ACTIVE_ROLE_ID] || "",
    resolvedChannels: {
      gamecall: padded[COL.GAME_CALL_CHANNEL_ID] || "",
      vod: padded[COL.VOD_CHANNEL_ID] || "",
      voicecheck: padded[COL.VOICE_CHECK_CHANNEL_ID] || "",
      unreg: padded[COL.UNREG_CHANNEL_ID] || "",
      dropmapcheck: padded[COL.DROPMAP_CHECK_CHANNEL_ID] || "",
      dropmapclosed: padded[COL.DROPMAP_CLOSED_CHANNEL_ID] || ""
    },
    channelOverrides: parseJsonCell(
      padded[COL.CHANNEL_OVERRIDES_JSON],
      {}
    ),
    config: parseJsonCell(padded[COL.CONFIG_JSON], {}),
    updatedAt: padded[COL.UPDATED_AT] || ""
  };
}

async function getSheetIdByTitle(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(
    entry => entry.properties?.title === title
  );

  return sheet?.properties?.sheetId ?? null;
}

async function ensureDashboardSheet() {
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
    range: `${SHEET_NAME}!A1:N1`
  });
  const headers = headerCheck.data.values?.[0] || [];
  const matches = DASHBOARD_HEADERS.every(
    (header, index) => headers[index] === header
  );

  if (matches) {
    return;
  }

  const firstCell = String(headers[0] || "").trim();

  if (firstCell && firstCell !== DASHBOARD_HEADERS[0] && sheetId) {
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
    requestBody: { values: [DASHBOARD_HEADERS] }
  });
}

async function getDashboardRows() {
  await ensureDashboardSheet();

  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: RANGE
  });

  return res.data.values || [];
}

async function getDashboard(guildId) {
  const rows = await getDashboardRows();

  for (const row of rows) {
    const record = rowToDashboard(row);

    if (record.guildId === guildId) {
      return record;
    }
  }

  return null;
}

async function upsertDashboard(record) {
  if (!record?.guildId) {
    throw new Error("Dashboard record requires guildId");
  }

  await ensureDashboardSheet();

  const rows = await getDashboardRows();
  const next = {
    ...record,
    dashboardChannelId:
      record.dashboardChannelId || DEFAULT_DASHBOARD_CHANNEL_ID,
    updatedAt: new Date().toISOString()
  };

  const values = rows.map(row => dashboardToRow(rowToDashboard(row)));
  const existingIndex = rows.findIndex(row => rowToDashboard(row).guildId === next.guildId);

  if (existingIndex >= 0) {
    values[existingIndex] = dashboardToRow({
      ...rowToDashboard(rows[existingIndex]),
      ...next,
      resolvedChannels: {
        ...rowToDashboard(rows[existingIndex]).resolvedChannels,
        ...(next.resolvedChannels || {})
      },
      channelOverrides: {
        ...rowToDashboard(rows[existingIndex]).channelOverrides,
        ...(next.channelOverrides || {})
      },
      config: {
        ...rowToDashboard(rows[existingIndex]).config,
        ...(next.config || {})
      }
    });
  } else {
    values.push(dashboardToRow(next));
  }

  await getSheets().spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: RANGE,
    valueInputOption: "RAW",
    requestBody: { values }
  });

  return getDashboard(next.guildId);
}

module.exports = {
  DASHBOARD_HEADERS,
  DEFAULT_DASHBOARD_CHANNEL_ID,
  ensureDashboardSheet,
  getDashboard,
  upsertDashboard,
  rowToDashboard,
  dashboardToRow
};
