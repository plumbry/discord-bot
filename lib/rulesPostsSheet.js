const { getSheets } = require("./sheets");

const SHEET_NAME = "Rules Posts";
const RANGE = `${SHEET_NAME}!A2:K`;
const HEADER_RANGE = `${SHEET_NAME}!A1:K1`;

const RULES_POSTS_HEADERS = [
  "Guild ID",
  "Scheduled Event ID",
  "Pack Type",
  "Key",
  "Mode",
  "Event Name",
  "Channel ID",
  "Rules Message ID",
  "Bans Message ID",
  "Posted At",
  "Updated At"
];

/**
 * Row 1 headers:
 * A Guild ID | B Scheduled Event ID | C Pack Type | D Key | E Mode
 * F Event Name | G Channel ID | H Rules Message ID | I Bans Message ID
 * J Posted At | K Updated At
 *
 * Pack type: rules | bans-only
 */

const COL = {
  GUILD_ID: 0,
  SCHEDULED_EVENT_ID: 1,
  PACK_TYPE: 2,
  KEY: 3,
  MODE: 4,
  EVENT_NAME: 5,
  CHANNEL_ID: 6,
  RULES_MESSAGE_ID: 7,
  BANS_MESSAGE_ID: 8,
  POSTED_AT: 9,
  UPDATED_AT: 10
};

const COLUMN_COUNT = 11;
const PACK_TYPES = {
  RULES: "rules",
  BANS_ONLY: "bans-only"
};

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

function rowToPost(row) {
  const padded = padRow(row);

  return {
    guildId: padded[COL.GUILD_ID],
    scheduledEventId: padded[COL.SCHEDULED_EVENT_ID],
    packType: (padded[COL.PACK_TYPE] || "").trim().toLowerCase(),
    key: padded[COL.KEY],
    mode: padded[COL.MODE] || "",
    eventName: padded[COL.EVENT_NAME] || "",
    channelId: padded[COL.CHANNEL_ID] || "",
    rulesMessageId: padded[COL.RULES_MESSAGE_ID] || "",
    bansMessageId: padded[COL.BANS_MESSAGE_ID] || "",
    postedAt: padded[COL.POSTED_AT] || "",
    updatedAt: padded[COL.UPDATED_AT] || "",
    fromSheet: true
  };
}

function postToRow(post) {
  const now = new Date().toISOString();

  return padRow([
    post.guildId,
    post.scheduledEventId,
    post.packType,
    post.key,
    post.mode || "",
    post.eventName || "",
    post.channelId || "",
    post.rulesMessageId || "",
    post.bansMessageId || "",
    post.postedAt || now,
    post.updatedAt || now
  ]);
}

async function getSheetIdByTitle(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(
    entry => entry.properties?.title === title
  );

  return sheet?.properties?.sheetId ?? null;
}

async function ensureRulesPostsSheet() {
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
    requestBody: { values: [RULES_POSTS_HEADERS] }
  });
}

async function getPostRows() {
  try {
    await ensureRulesPostsSheet();

    const res = await getSheets().spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: RANGE
    });

    return res.data.values || [];
  } catch (err) {
    if (err?.message?.includes("Unable to parse range")) {
      return [];
    }

    console.error("[RULES POSTS SHEET] getPostRows:", err);
    throw err;
  }
}

async function writePostRows(rows) {
  await ensureRulesPostsSheet();

  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();
  const values = rows.map(row => postToRow(rowToPost(row)));

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

async function upsertRulesPost(post) {
  if (!post?.guildId || !post?.key) {
    return null;
  }

  const rows = await getPostRows();
  const now = new Date().toISOString();
  const nextPost = {
    ...post,
    packType: post.packType || PACK_TYPES.BANS_ONLY,
    postedAt: post.postedAt || now,
    updatedAt: now
  };
  const nextRow = postToRow(nextPost);

  let found = false;
  const nextRows = rows.map(row => {
    const existing = rowToPost(row);

    if (existing.guildId === post.guildId && existing.key === post.key) {
      found = true;
      return nextRow;
    }

    return padRow(row);
  });

  if (!found) {
    nextRows.push(nextRow);
  }

  await writePostRows(nextRows);
  return nextPost;
}

async function listPostsForScheduledEvent(guildId, scheduledEventId) {
  if (!guildId || !scheduledEventId) {
    return [];
  }

  try {
    const rows = await getPostRows();

    return rows
      .map(rowToPost)
      .filter(
        post =>
          post.guildId === guildId &&
          post.scheduledEventId === scheduledEventId &&
          post.bansMessageId
      )
      .sort((a, b) =>
        (b.updatedAt || b.postedAt || "").localeCompare(
          a.updatedAt || a.postedAt || ""
        )
      );
  } catch (err) {
    if (err?.message?.includes("MAIN_SHEET_ID")) {
      throw err;
    }

    console.error("[RULES POSTS SHEET] listPostsForScheduledEvent:", err);
    return [];
  }
}

async function findPostByBansMessageId(guildId, bansMessageId) {
  if (!guildId || !bansMessageId) {
    return null;
  }

  try {
    const rows = await getPostRows();

    for (const row of rows) {
      const post = rowToPost(row);

      if (post.guildId === guildId && post.bansMessageId === bansMessageId) {
        return post;
      }
    }

    return null;
  } catch (err) {
    console.error("[RULES POSTS SHEET] findPostByBansMessageId:", err);
    return null;
  }
}

module.exports = {
  SHEET_NAME,
  PACK_TYPES,
  ensureRulesPostsSheet,
  upsertRulesPost,
  listPostsForScheduledEvent,
  findPostByBansMessageId
};
