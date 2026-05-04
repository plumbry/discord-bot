const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");
const { google } = require("googleapis");

// ================= CONFIG =================

const SHEET_ID = process.env.MAIN_SHEET_ID;
const EVENT_SHEET = "Event Bans";
const AUDIT_SHEET = "Audit Log";
const BAN_CHANNEL_ID = "1472795189515915466";

// ================= GOOGLE AUTH =================

const credentials = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// ================= HELPERS =================

const today = () => new Date().toLocaleDateString("en-GB");

function formatUser(text) {
  return `\`${text}\``;
}

function parseDateInput(str) {
  if (!str) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

  let match;

  if ((match = str.match(iso))) {
    const [, y, m, d] = match;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  if ((match = str.match(uk))) {
    const [, d, m, y] = match;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  return null;
}

function getDaysRemaining(endDateStr) {
  const end = parseDateInput(endDateStr);
  if (!end) return 0;

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const diffMs = end - now;
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

async function handleExpiredProbations(rows, banChannel) {
  let updated = false;

  for (const r of rows) {

    if (r[2] !== "Probation") continue;

    const daysRemaining = getDaysRemaining(r[6]);

    if (Number(r[4]) === 0) continue;
    if (daysRemaining > 0) continue;

    r[4] = 0;
    updated = true;

    try {
      await banChannel.send(
        `🔔 PROBATION ENDED for ${formatUser(r[1])}`
      );
    } catch (err) {
      console.error("PROBATION ENDED SEND ERROR:", err);
    }

    if (r[9]) {
      try {
        const msg = await banChannel.messages.fetch(r[9]);
        await msg.edit(
          `${formatUser(r[1])} — Probation\nEnded ${r[6]}`
        );
      } catch (err) {
        console.error("PROBATION MESSAGE EDIT ERROR:", err);
      }
    }
  }

  return updated;
}

async function logAudit(action, moderator, user = "") {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${AUDIT_SHEET}!A2:D`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          today(),
          action,
          moderator.tag,
          user?.tag || user
        ]]
      }
    });
  } catch (err) {
    console.error("AUDIT LOG ERROR:", err);
  }
}

async function getRows() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${EVENT_SHEET}!A2:J`
    });

    return res.data.values || [];
  } catch (err) {
    console.error("GET ROWS ERROR:", err);
    return [];
  }
}

async function writeRows(rows) {
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${EVENT_SHEET}!A2:J`
    });

    if (rows.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${EVENT_SHEET}!A2:J`,
        valueInputOption: "RAW",
        requestBody: { values: rows }
      });
    }
  } catch (err) {
    console.error("WRITE ROWS ERROR:", err);
  }
}

// ================= COMMAND =================
// (rest of your file unchanged)