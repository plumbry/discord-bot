const { getSheets } = require("./sheets");

const SHEET_TAB = process.env.DARE_TO_GREED_SHEET_NAME || "Dare to Greed";
const MOD_LOG_SHEET_ID = "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM";

const HEADERS = ["Captain name", "Game 1", "Game 2", "Game 3", "Game 4"];

const GAME_COLUMNS = {
  1: "B",
  2: "C",
  3: "D",
  4: "E"
};

let writeQueue = Promise.resolve();

function getSpreadsheetId() {
  return (
    process.env.DARE_TO_GREED_SHEET_ID ||
    process.env.MAIN_SHEET_ID ||
    MOD_LOG_SHEET_ID
  );
}

function sheetsConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 && getSpreadsheetId()
  );
}

function enqueueWrite(fn) {
  const run = writeQueue.then(fn, fn);

  writeQueue = run.catch(err => {
    console.error("[DARE TO GREED] sheet write failed:", err?.message || err);
  });

  return run;
}

function sheetText(value) {
  const text = String(value ?? "");

  if (/^[=+\-@]/.test(text)) {
    return `'${text}`;
  }

  return text;
}

function quotedSheetName() {
  if (/^[A-Za-z0-9_]+$/.test(SHEET_TAB)) {
    return SHEET_TAB;
  }

  return `'${String(SHEET_TAB).replace(/'/g, "''")}'`;
}

function sheetRange(a1) {
  return `${quotedSheetName()}!${a1}`;
}

async function getSheetIdByTitle(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(
    item => item.properties?.title === title
  );

  return sheet?.properties?.sheetId ?? null;
}

async function ensureSheet() {
  if (!sheetsConfigured()) {
    throw new Error(
      "Google Sheets is not configured (need GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 and a Mod Log sheet id)."
    );
  }

  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();
  let sheetId = await getSheetIdByTitle(sheets, spreadsheetId, SHEET_TAB);

  if (sheetId == null) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_TAB } } }]
      }
    });

    sheetId = created.data.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
  }

  const headerCheck = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetRange("A1:E1")
  });
  const existing = headerCheck.data.values?.[0] || [];
  const firstCell = String(existing[0] || "").trim().toLowerCase();

  if (firstCell === "captain name") {
    return;
  }

  if (firstCell && sheetId != null) {
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
    range: sheetRange("A1:E1"),
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] }
  });
}

async function replaceCaptains(captains) {
  return enqueueWrite(async () => {
    await ensureSheet();

    const sheets = getSheets();
    const spreadsheetId = getSpreadsheetId();

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: sheetRange("A2:E")
    });

    const unique = [];
    const seen = new Set();

    for (const captain of captains || []) {
      const userId = String(captain.userId || "").trim();

      if (!userId || seen.has(userId)) {
        continue;
      }

      seen.add(userId);
      unique.push({
        userId,
        displayName: String(captain.displayName || userId).trim() || userId
      });
    }

    if (!unique.length) {
      return [];
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(`A2:A${unique.length + 1}`),
      valueInputOption: "RAW",
      requestBody: {
        values: unique.map(captain => [sheetText(captain.displayName)])
      }
    });

    return unique.map((captain, index) => ({
      ...captain,
      rowNumber: index + 2
    }));
  });
}

async function writeLockedColumn(gameNumber, rows) {
  const column = GAME_COLUMNS[Number(gameNumber)];

  if (!column) {
    throw new Error("Dare to Greed only supports games 1–4.");
  }

  return enqueueWrite(async () => {
    await ensureSheet();

    const data = (rows || [])
      .filter(row => Number(row.rowNumber) >= 2)
      .map(row => ({
        range: sheetRange(`${column}${row.rowNumber}`),
        values: [[sheetText(row.choice || "")]]
      }));

    if (!data.length) {
      return;
    }

    await getSheets().spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        valueInputOption: "RAW",
        data
      }
    });
  });
}

module.exports = {
  SHEET_TAB,
  sheetsConfigured,
  ensureSheet,
  replaceCaptains,
  writeLockedColumn
};
