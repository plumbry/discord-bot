const { google } = require("googleapis");

const SHEET_ID = "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM";
const EVENT_SHEET = "Event Bans";
const BAN_CHANNEL_ID = "1472795189515915466";

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

function parseDateGB(str) {
  if (!str) return null;
  const [d, m, y] = str.split("/").map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

async function getRows() {

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${EVENT_SHEET}!A2:J`
  });

  return res.data.values || [];
}

async function writeRows(rows) {

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

}

async function checkBanExpiries(client) {

  const rows = await getRows();
  const channel = await client.channels.fetch(BAN_CHANNEL_ID);

  const now = new Date();
  let updated = false;

  for (const r of rows) {

    const type = r[2];
    const eventsRemaining = Number(r[4] || 0);
    const endDate = parseDateGB(r[6]);
    const alerted = r[9] === "ENDED";

    if (alerted) continue;

    // Event ban ended
    if (type !== "Probation" && eventsRemaining === 0) {

      await channel.send(
        `✅ **Event ban ended** for **${r[1]}** (${type})`
      );

      r[9] = "ENDED";
      updated = true;
    }

    // Probation ended
    if (type === "Probation" && endDate && endDate < now) {

      await channel.send(
        `✅ **Probation ended** for **${r[1]}**`
      );

      r[9] = "ENDED";
      updated = true;
    }

  }

  if (updated)
    await writeRows(rows);

}

function startBanExpiryChecker(client) {

  setInterval(() => {
    checkBanExpiries(client).catch(console.error);
  }, 5 * 60 * 1000); // every 5 minutes

}

module.exports = {
  startBanExpiryChecker
};