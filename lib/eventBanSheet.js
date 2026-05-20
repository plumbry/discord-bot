const { getSheets } = require("./sheets");

const EVENT_SHEET = "Event Bans";
const EVENT_BAN_COLUMNS = 11;
const EVENT_BAN_RANGE = `${EVENT_SHEET}!A2:K`;

function normalizeRow(row) {

  const copy = [...row];

  while (copy.length < EVENT_BAN_COLUMNS) {
    copy.push("");
  }

  return copy.slice(0, EVENT_BAN_COLUMNS);

}

function normalizeRows(rows) {

  return rows.map(normalizeRow);

}

function sheetRowNumber(index) {
  return index + 2;
}

function rowRange(sheetRow) {
  return `${EVENT_SHEET}!A${sheetRow}:K${sheetRow}`;
}

async function getEventBanRows() {

  const sheetId = process.env.MAIN_SHEET_ID;

  if (!sheetId) {
    return [];
  }

  try {

    const sheets = getSheets();

    const res =
      await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: EVENT_BAN_RANGE
      });

    return res.data.values || [];

  } catch (err) {

    console.error("GET EVENT BAN ROWS ERROR:", err);
    return [];

  }

}

async function writeEventBanRows(rows) {

  const sheetId = process.env.MAIN_SHEET_ID;

  if (!sheetId) {
    return;
  }

  try {

    const sheets = getSheets();

    if (!rows.length) {

      await sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: EVENT_BAN_RANGE
      });

      return;

    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: EVENT_BAN_RANGE,
      valueInputOption: "RAW",
      requestBody: {
        values: normalizeRows(rows)
      }
    });

  } catch (err) {

    console.error("WRITE EVENT BAN ROWS ERROR:", err);

  }

}

async function appendEventBanRow(row) {

  const sheetId = process.env.MAIN_SHEET_ID;

  if (!sheetId) {
    return null;
  }

  const sheets = getSheets();

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${EVENT_SHEET}!A:K`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [normalizeRow(row)]
    }
  });

  const updatedRange =
    res.data.updates?.updatedRange || "";

  const match = updatedRange.match(/!(?:[A-Z]+)(\d+):/i);

  return match ? Number(match[1]) : null;

}

async function batchUpdateEventBanRows(updates) {

  const sheetId = process.env.MAIN_SHEET_ID;

  if (!sheetId || !updates.length) {
    return;
  }

  const sheets = getSheets();

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: updates.map(({ sheetRow, row }) => ({
        range: rowRange(sheetRow),
        values: [normalizeRow(row)]
      }))
    }
  });

}

module.exports = {
  EVENT_SHEET,
  EVENT_BAN_RANGE,
  EVENT_BAN_COLUMNS,
  getEventBanRows,
  writeEventBanRows,
  appendEventBanRow,
  batchUpdateEventBanRows,
  normalizeRows,
  normalizeRow,
  sheetRowNumber
};
