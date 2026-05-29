const crypto = require("crypto");

const { getSheets } = require("./sheets");
const { parseSheetDateTime } = require("./sheetDateTime");

const SHEET_NAME = "Scrim Events";

const ROW_RANGE = `${SHEET_NAME}!A:O`;

/**
 * Sheet columns (row 1 headers):
 * A Job ID | B Status | C Send At | D Channel ID | E Guild ID
 * F Content | G Ping Everyone | H Moderator ID | I Event Name | J Mode
 * K Schedule | L Created At | M Sent At | N Message URL | O Error
 */

const COL = {
  JOB_ID: 0,
  STATUS: 1,
  SEND_AT: 2,
  CHANNEL_ID: 3,
  GUILD_ID: 4,
  CONTENT: 5,
  PING_EVERYONE: 6,
  MODERATOR_ID: 7,
  EVENT_NAME: 8,
  MODE: 9,
  SCHEDULE: 10,
  CREATED_AT: 11,
  SENT_AT: 12,
  MESSAGE_URL: 13,
  ERROR: 14
};

const COLUMN_COUNT = 15;

let schedulerRunning = false;

const nowISO = () => new Date().toISOString();

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

async function updateScrimEventRow(rowNumber, row) {
  await getSheets().spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!A${rowNumber}:O${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [padRow(row)]
    }
  });
}

async function appendScheduledReminder({
  sendAt,
  channelId,
  guildId,
  content,
  pingEveryone,
  moderatorId,
  eventName,
  mode,
  scheduleLabel
}) {
  const jobId = crypto.randomUUID();

  const row = padRow([
    jobId,
    "scheduled",
    new Date(sendAt).toISOString(),
    channelId,
    guildId,
    content,
    pingEveryone ? "true" : "false",
    moderatorId,
    eventName,
    mode,
    scheduleLabel,
    nowISO(),
    "",
    "",
    ""
  ]);

  await getSheets().spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: ROW_RANGE,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row]
    }
  });

  return jobId;
}

function rowToScrimEvent(row) {
  const padded = padRow(row);

  return {
    jobId: padded[COL.JOB_ID] || "",
    status: padded[COL.STATUS] || "",
    sendAt: padded[COL.SEND_AT] || "",
    channelId: padded[COL.CHANNEL_ID] || "",
    guildId: padded[COL.GUILD_ID] || "",
    content: padded[COL.CONTENT] || "",
    pingEveryone: padded[COL.PING_EVERYONE] === "true",
    moderatorId: padded[COL.MODERATOR_ID] || "",
    eventName: padded[COL.EVENT_NAME] || "",
    mode: padded[COL.MODE] || "",
    schedule: padded[COL.SCHEDULE] || "",
    createdAt: padded[COL.CREATED_AT] || "",
    sentAt: padded[COL.SENT_AT] || "",
    messageUrl: padded[COL.MESSAGE_URL] || "",
    error: padded[COL.ERROR] || ""
  };
}

async function listScrimEventsForGuild(guildId) {
  if (!guildId) {
    return [];
  }

  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!A2:O`
  });

  const rows = res.data.values || [];

  return rows
    .map(rowToScrimEvent)
    .filter(event => event.guildId === guildId && event.jobId)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function isScheduledStatus(status) {
  return String(status || "").trim().toLowerCase() === "scheduled";
}

async function processDueReminders(client) {
  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_NAME}!A2:O`,
    valueRenderOption: "UNFORMATTED_VALUE"
  });

  const rows = res.data.values || [];
  const now = new Date();

  for (let i = 0; i < rows.length; i++) {
    const row = padRow(rows[i]);
    const rowNumber = i + 2;

    if (!isScheduledStatus(row[COL.STATUS])) {
      continue;
    }

    const sendAt = parseSheetDateTime(row[COL.SEND_AT]);

    if (Number.isNaN(sendAt.getTime())) {
      console.warn(
        `[SCRIM EVENTS] Row ${rowNumber} (${row[COL.EVENT_NAME] || "unknown"}): ` +
          `invalid Send At "${row[COL.SEND_AT]}" — cannot post`
      );
      continue;
    }

    if (sendAt > now) {
      continue;
    }

    try {
      const channel = await client.channels.fetch(row[COL.CHANNEL_ID]);

      if (!channel?.isTextBased?.()) {
        throw new Error(`Channel ${row[COL.CHANNEL_ID]} is not sendable`);
      }

      const pingEveryone = row[COL.PING_EVERYONE] === "true";

      const message = await channel.send({
        content: row[COL.CONTENT],
        allowedMentions: pingEveryone
          ? { parse: ["everyone"] }
          : { parse: [] }
      });

      row[COL.STATUS] = "sent";
      row[COL.SENT_AT] = nowISO();
      row[COL.MESSAGE_URL] = message.url;
      row[COL.ERROR] = "";

      console.log(
        `[SCRIM EVENTS] Sent reminder row ${rowNumber} ` +
          `(${row[COL.EVENT_NAME] || row[COL.JOB_ID]}) → ${message.url}`
      );
    } catch (err) {
      console.error("[SCRIM EVENTS]", err);

      row[COL.STATUS] = "failed";
      row[COL.ERROR] = err?.message || String(err);
    }

    await updateScrimEventRow(rowNumber, row);
  }
}

function startScrimRemindScheduler(client) {
  const tick = async () => {
    if (schedulerRunning) {
      return;
    }

    schedulerRunning = true;

    try {
      await processDueReminders(client);
    } catch (err) {
      console.error("[SCRIM EVENTS SCHEDULER]", err);
    } finally {
      schedulerRunning = false;
    }
  };

  setInterval(tick, 30_000);

  setTimeout(tick, 10_000);

  console.log("✅ Scrim Events sheet scheduler running (30s poll)");
}

module.exports = {
  SHEET_NAME,
  appendScheduledReminder,
  listScrimEventsForGuild,
  startScrimRemindScheduler
};
