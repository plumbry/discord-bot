const { getSheets } = require("./sheets");

const SHEET_TAB = process.env.ANONQ_SHEET_NAME || "anonq";
const MOD_LOG_SHEET_ID = "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM";

const HEADERS = [
  "Timestamp",
  "Reference",
  "Discord User ID",
  "Username",
  "Question",
  "Message ID",
  "Channel ID",
  "Guild ID"
];

const COL = {
  TIMESTAMP: 0,
  REFERENCE: 1,
  USER_ID: 2,
  USERNAME: 3,
  QUESTION: 4,
  MESSAGE_ID: 5,
  CHANNEL_ID: 6,
  GUILD_ID: 7
};

const COLUMN_COUNT = HEADERS.length;
const pendingReferences = new Set();
let writeQueue = Promise.resolve();

function getSpreadsheetId() {
  return (
    process.env.ANONQ_SHEET_ID ||
    process.env.MAIN_SHEET_ID ||
    MOD_LOG_SHEET_ID
  );
}

function sheetsConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 && getSpreadsheetId()
  );
}

function nowISO() {
  return new Date().toISOString();
}

function padRow(row) {
  const padded = [...row];

  while (padded.length < COLUMN_COUNT) {
    padded.push("");
  }

  return padded.slice(0, COLUMN_COUNT);
}

function sheetIdCell(id) {
  return id ? `'${id}` : "";
}

function cleanDiscordId(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? String(value) : "";
  }

  const digits = String(value)
    .normalize("NFKC")
    .replace(/^'/, "")
    .replace(/[^\d]/g, "")
    .trim();

  return digits.length >= 17 && digits.length <= 20 ? digits : String(value).replace(/^'/, "").trim();
}

function formatReference(n) {
  return `AQ-${String(n).padStart(4, "0")}`;
}

function parseReferenceNumber(value) {
  const raw = String(value || "").trim().toUpperCase();
  const match = raw.match(/^(?:AQ-)?(\d+)$/);

  if (!match) {
    return null;
  }

  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeReference(value) {
  const n = parseReferenceNumber(value);
  return n === null ? "" : formatReference(n);
}

function rowToEntry(row, rowNumber) {
  const padded = padRow(row);
  const reference = normalizeReference(padded[COL.REFERENCE]);

  if (!reference) {
    return null;
  }

  return {
    rowNumber,
    timestamp: padded[COL.TIMESTAMP] || "",
    reference,
    userId: cleanDiscordId(padded[COL.USER_ID]),
    username: padded[COL.USERNAME] || "",
    question: padded[COL.QUESTION] || "",
    messageId: cleanDiscordId(padded[COL.MESSAGE_ID]),
    channelId: cleanDiscordId(padded[COL.CHANNEL_ID]),
    guildId: cleanDiscordId(padded[COL.GUILD_ID])
  };
}

function entryToRow(entry) {
  return padRow([
    entry.timestamp || nowISO(),
    entry.reference,
    sheetIdCell(entry.userId),
    entry.username || "",
    entry.question || "",
    sheetIdCell(entry.messageId),
    sheetIdCell(entry.channelId),
    sheetIdCell(entry.guildId)
  ]);
}

function enqueueWrite(fn) {
  const run = writeQueue.then(fn, fn);

  writeQueue = run.catch(err => {
    console.error("[ANONQ] sheet write failed:", err?.message || err);
  });

  return run;
}

async function getSheetIdByTitle(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(
    item => item.properties?.title === title
  );

  return sheet?.properties?.sheetId ?? null;
}

async function ensureAnonqSheet() {
  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();
  let sheetId = await getSheetIdByTitle(sheets, spreadsheetId, SHEET_TAB);

  if (!sheetId) {
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
    range: `${SHEET_TAB}!A1:H1`
  });
  const existing = headerCheck.data.values?.[0] || [];
  const firstCell = String(existing[0] || "").trim().toLowerCase();

  if (firstCell === "timestamp") {
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
    range: `${SHEET_TAB}!A1:H1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] }
  });
}

async function readAllRows() {
  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_TAB}!A2:H`,
    valueRenderOption: "UNFORMATTED_VALUE"
  });

  return res.data.values || [];
}

async function listEntries() {
  await ensureAnonqSheet();

  const rows = await readAllRows();
  const entries = [];

  for (let i = 0; i < rows.length; i++) {
    const entry = rowToEntry(rows[i], i + 2);

    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

async function getEntryByReference(reference) {
  const target = normalizeReference(reference);

  if (!target) {
    return null;
  }

  const entries = await listEntries();
  return entries.find(entry => entry.reference === target) || null;
}

async function getEntriesByUserId(userId) {
  const target = cleanDiscordId(userId);

  if (!target) {
    return [];
  }

  const entries = await listEntries();
  return entries.filter(entry => entry.userId === target);
}

async function allocateReference() {
  if (!sheetsConfigured()) {
    throw new Error("ANONQ_SHEET_NOT_CONFIGURED");
  }

  return enqueueWrite(async () => {
    await ensureAnonqSheet();

    const rows = await readAllRows();
    const used = new Set(pendingReferences);

    let max = 0;

    for (const row of rows) {
      const ref = normalizeReference(row[COL.REFERENCE]);

      if (ref) {
        used.add(ref);
      }

      const n = parseReferenceNumber(ref || row[COL.REFERENCE]);

      if (n != null) {
        max = Math.max(max, n);
      }
    }

    let next = max + 1;
    let reference = formatReference(next);

    while (used.has(reference)) {
      next += 1;
      reference = formatReference(next);
    }

    pendingReferences.add(reference);
    return reference;
  });
}

function releaseReference(reference) {
  const normalized = normalizeReference(reference);

  if (normalized) {
    pendingReferences.delete(normalized);
  }
}

async function appendAnonqEntry(entry) {
  if (!sheetsConfigured()) {
    throw new Error("ANONQ_SHEET_NOT_CONFIGURED");
  }

  const reference = normalizeReference(entry.reference);

  if (!reference) {
    throw new Error("ANONQ_REFERENCE_REQUIRED");
  }

  return enqueueWrite(async () => {
    try {
      await ensureAnonqSheet();

      const record = {
        timestamp: entry.timestamp || nowISO(),
        reference,
        userId: String(entry.userId || ""),
        username: entry.username || "",
        question: entry.question || "",
        messageId: String(entry.messageId || ""),
        channelId: String(entry.channelId || ""),
        guildId: String(entry.guildId || "")
      };

      const res = await getSheets().spreadsheets.values.append({
        spreadsheetId: getSpreadsheetId(),
        range: `${SHEET_TAB}!A:H`,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [entryToRow(record)] }
      });

      const updatedRange = res.data.updates?.updatedRange || "";
      const match = updatedRange.match(/!(?:[A-Z]+)(\d+)/);

      return {
        ...record,
        rowNumber: match ? Number(match[1]) : null
      };
    } finally {
      pendingReferences.delete(reference);
    }
  });
}

module.exports = {
  SHEET_TAB,
  HEADERS,
  sheetsConfigured,
  ensureAnonqSheet,
  normalizeReference,
  listEntries,
  getEntryByReference,
  getEntriesByUserId,
  allocateReference,
  releaseReference,
  appendAnonqEntry
};
