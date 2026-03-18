// ===== GIRL ROLE SYSTEM START =====
const { google } = require("googleapis");

const ROLE_ID = "1371652325629755472";
const GIRL_ROLE_SHEET = "Girl Role";
const SHEET_ID = "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM";

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

// ===== CACHE =====
let girlCache = new Set();

async function loadGirlCache() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${GIRL_ROLE_SHEET}!A:A`
  });

  girlCache = new Set((res.data.values || []).map(r => r[0]));
  console.log("Girl cache loaded:", girlCache.size);
}

function isGirlVerified(userId) {
  return girlCache.has(userId);
}

async function addGirlVerified(user) {

  if (girlCache.has(user.id)) return;

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${GIRL_ROLE_SHEET}!A:B`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[user.id, user.tag]]
      }
    });

    girlCache.add(user.id);

  } catch (err) {
    console.error("SHEETS ERROR:", err);
  }

}
// ===== GIRL ROLE SYSTEM END =====