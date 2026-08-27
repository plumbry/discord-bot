const crypto = require("crypto");
const { getSheets } = require("./sheets");

const SHEET_TAB = process.env.LFG_SHEET_NAME || "LFG";
const MOD_LOG_SHEET_ID = "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM";

const HEADERS = [
  "Type",
  "ID",
  "Event ID",
  "Event Name",
  "Guild ID",
  "Owner User ID",
  "Status",
  "Active",
  "Summary",
  "Payload",
  "Created At",
  "Updated At"
];

const COL = {
  TYPE: 0,
  ID: 1,
  EVENT_ID: 2,
  EVENT_NAME: 3,
  GUILD_ID: 4,
  OWNER_USER_ID: 5,
  STATUS: 6,
  ACTIVE: 7,
  SUMMARY: 8,
  PAYLOAD: 9,
  CREATED_AT: 10,
  UPDATED_AT: 11
};

const LOOK_REQUEST_TYPES = new Set([
  "needs_team",
  "needs_players",
  "can_fill"
]);

const POST_FILL_TYPE = "post_fill";
const POST_NEED_TYPE = "post_need";

const nowISO = () => new Date().toISOString();

function isLookRequest(request) {
  return LOOK_REQUEST_TYPES.has(request?.type);
}

function isPostFill(request) {
  return request?.type === POST_FILL_TYPE;
}

function isPostNeed(request) {
  return request?.type === POST_NEED_TYPE;
}

function getSpreadsheetId() {
  return (
    process.env.LFG_SHEET_ID ||
    process.env.GENDER_SHEET_ID ||
    process.env.GIRL_ROLE_SHEET_ID ||
    process.env.MAIN_SHEET_ID ||
    MOD_LOG_SHEET_ID
  );
}

function sheetsConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 && getSpreadsheetId()
  );
}

function padRow(row) {
  const padded = [...row];

  while (padded.length < HEADERS.length) {
    padded.push("");
  }

  return padded.slice(0, HEADERS.length);
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function withoutRowNumber(record) {
  const copy = { ...record };
  delete copy.rowNumber;
  return copy;
}

function eventSummary(event) {
  const enabled = event.lfgEnabled ? "enabled" : "disabled";
  return `${event.format || "?"} · ${event.tierRuleId || "standard"} · ${enabled}`;
}

function requestSummary(request) {
  if (isPostFill(request)) {
    return `FILL · ${request.loggedTier || "?"} · ${request.loggedGender || "?"}`;
  }

  if (isPostNeed(request)) {
    const tiers = (request.acceptedTiers || []).join("/") || "?";
    return `NEED · ${tiers} · ${request.requiredGender || "?"}`;
  }

  const count = (request.memberUserIds || []).length;
  return `${request.type || "?"} · ${count} player${count === 1 ? "" : "s"}`;
}

function matchSummary(match) {
  const size = (match.userIds || []).length;
  const kind = match.complete ? "complete" : "partial";
  return `${kind} · ${size} players · ${match.status || "proposed"}`;
}

function eventToRow(event) {
  return padRow([
    "event",
    event.discordEventId,
    event.discordEventId,
    event.eventName || "",
    event.guildId || "",
    event.createdBy || "",
    event.lfgEnabled ? "enabled" : "disabled",
    event.lfgEnabled ? "true" : "false",
    eventSummary(event),
    JSON.stringify(withoutRowNumber(event)),
    event.createdAt || "",
    event.updatedAt || ""
  ]);
}

function requestToRow(request) {
  return padRow([
    "request",
    request.id,
    request.eventId || "",
    "",
    request.guildId || "",
    request.ownerUserId || "",
    request.type || "",
    request.active ? "true" : "false",
    requestSummary(request),
    JSON.stringify(withoutRowNumber(request)),
    request.createdAt || "",
    request.updatedAt || ""
  ]);
}

function matchToRow(match) {
  return padRow([
    "match",
    match.id,
    match.eventId || "",
    "",
    "",
    "",
    match.status || "proposed",
    match.status === "dead" ? "false" : "true",
    matchSummary(match),
    JSON.stringify(withoutRowNumber(match)),
    match.createdAt || "",
    match.updatedAt || ""
  ]);
}

function parseEventRecord(payload, rowNumber) {
  return {
    discordEventId: String(payload.discordEventId || payload.id || ""),
    eventName: String(payload.eventName || ""),
    guildId: String(payload.guildId || ""),
    format: String(payload.format || ""),
    teamSize: Number(payload.teamSize) || 0,
    tierRuleId: String(payload.tierRuleId || "standard"),
    lfgEnabled: parseBool(payload.lfgEnabled, false),
    startTime: payload.startTime || "",
    lfgChannelId: String(payload.lfgChannelId || ""),
    lfgMessageId: String(payload.lfgMessageId || ""),
    excludeRoleId: String(payload.excludeRoleId || ""),
    mentionEveryone: parseBool(payload.mentionEveryone, false),
    lfgPostEnabled: payload.lfgPostEnabled === undefined
      ? Boolean(payload.lfgMessageId)
      : parseBool(payload.lfgPostEnabled, false),
    createdAt: payload.createdAt || "",
    updatedAt: payload.updatedAt || "",
    createdBy: payload.createdBy || "",
    rowNumber
  };
}

function parseRequestRecord(payload, rowNumber) {
  return {
    id: String(payload.id || ""),
    eventId: String(payload.eventId || ""),
    guildId: String(payload.guildId || ""),
    ownerUserId: String(payload.ownerUserId || ""),
    type: String(payload.type || ""),
    memberUserIds: Array.isArray(payload.memberUserIds)
      ? payload.memberUserIds.map(String)
      : [],
    note: String(payload.note || ""),
    active: parseBool(payload.active, false),
    dmOk: parseBool(payload.dmOk, false),
    source: String(payload.source || "lfg"),
    username: String(payload.username || ""),
    loggedTier: String(payload.loggedTier || ""),
    loggedGender: String(payload.loggedGender || ""),
    acceptedTiers: Array.isArray(payload.acceptedTiers)
      ? payload.acceptedTiers.map(value => String(value).toUpperCase())
      : [],
    requiredGender: String(payload.requiredGender || ""),
    notifiedFillUserIds: Array.isArray(payload.notifiedFillUserIds)
      ? payload.notifiedFillUserIds.map(String)
      : [],
    status: String(
      payload.status || (parseBool(payload.active, false) ? "OPEN" : "CLOSED")
    ).toUpperCase(),
    eventName: String(payload.eventName || ""),
    eventStart: payload.eventStart || "",
    format: String(payload.format || ""),
    createdAt: payload.createdAt || "",
    updatedAt: payload.updatedAt || "",
    closedAt: payload.closedAt || "",
    closedReason: payload.closedReason || "",
    rowNumber
  };
}

function parseMatchRecord(payload, rowNumber) {
  return {
    id: String(payload.id || ""),
    eventId: String(payload.eventId || ""),
    requestIds: Array.isArray(payload.requestIds)
      ? payload.requestIds.map(String)
      : [],
    userIds: Array.isArray(payload.userIds) ? payload.userIds.map(String) : [],
    complete: parseBool(payload.complete, false),
    status: String(payload.status || "proposed"),
    interestedOwnerIds: Array.isArray(payload.interestedOwnerIds)
      ? payload.interestedOwnerIds.map(String)
      : [],
    dismissedOwnerIds: Array.isArray(payload.dismissedOwnerIds)
      ? payload.dismissedOwnerIds.map(String)
      : [],
    notifiedOwnerIds: Array.isArray(payload.notifiedOwnerIds)
      ? payload.notifiedOwnerIds.map(String)
      : [],
    createdAt: payload.createdAt || "",
    updatedAt: payload.updatedAt || "",
    rowNumber
  };
}

function parseRow(row, rowNumber) {
  const padded = padRow(row);
  const type = String(padded[COL.TYPE] || "").trim().toLowerCase();
  const payload = parseJson(padded[COL.PAYLOAD], null);

  if (!payload || !type) {
    return null;
  }

  if (type === "event") {
    return { type, record: parseEventRecord(payload, rowNumber) };
  }

  if (type === "request") {
    return { type, record: parseRequestRecord(payload, rowNumber) };
  }

  if (type === "match") {
    return { type, record: parseMatchRecord(payload, rowNumber) };
  }

  return null;
}

/** @type {{ events: object[], requests: object[], matches: object[], loaded: boolean }} */
const cache = {
  events: [],
  requests: [],
  matches: [],
  loaded: false
};

let loadPromise = null;
let writeQueue = Promise.resolve();

function enqueueWrite(fn) {
  const run = writeQueue.then(fn, fn);

  writeQueue = run.catch(err => {
    console.error("[LFG] sheet write failed:", err?.message || err);
  });

  return run;
}

async function getSheetIdByTitle(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find(
    entry => entry.properties?.title === title
  );

  return sheet?.properties?.sheetId ?? null;
}

async function ensureLfgSheet() {
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
    range: `${SHEET_TAB}!A1:L1`
  });
  const existing = headerCheck.data.values?.[0] || [];
  const firstCell = String(existing[0] || "").trim();

  if (!firstCell) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TAB}!A1:L1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS] }
    });
  }
}

async function readAllRows() {
  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_TAB}!A2:L`
  });

  return res.data.values || [];
}

async function writeRow(rowNumber, row) {
  await getSheets().spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_TAB}!A${rowNumber}:L${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [padRow(row)] }
  });
}

async function appendRow(row) {
  const res = await getSheets().spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${SHEET_TAB}!A:L`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [padRow(row)] }
  });

  const updatedRange = res.data.updates?.updatedRange || "";
  const match = updatedRange.match(/!(?:[A-Z]+)(\d+)/);

  return match ? Number(match[1]) : null;
}

async function loadFromSheets() {
  await ensureLfgSheet();

  const rows = await readAllRows();
  const events = [];
  const requests = [];
  const matches = [];

  for (let i = 0; i < rows.length; i++) {
    const parsed = parseRow(rows[i], i + 2);

    if (!parsed) {
      continue;
    }

    if (parsed.type === "event" && parsed.record.discordEventId) {
      events.push(parsed.record);
    } else if (parsed.type === "request" && parsed.record.id) {
      requests.push(parsed.record);
    } else if (parsed.type === "match" && parsed.record.id) {
      matches.push(parsed.record);
    }
  }

  cache.events = events;
  cache.requests = requests;
  cache.matches = matches;
  cache.loaded = true;
}

async function ensureLoaded() {
  if (cache.loaded) {
    return;
  }

  if (!sheetsConfigured()) {
    cache.loaded = true;
    console.warn("[LFG] Google Sheets not configured — using in-memory LFG state only");
    return;
  }

  if (!loadPromise) {
    loadPromise = loadFromSheets().catch(err => {
      loadPromise = null;
      console.error("[LFG] failed to load Mod Log LFG sheet:", err?.message || err);
      cache.loaded = true;
    });
  }

  await loadPromise;
}

async function persistEvent(event) {
  if (!sheetsConfigured()) {
    return;
  }

  await enqueueWrite(async () => {
    if (event.rowNumber) {
      await writeRow(event.rowNumber, eventToRow(event));
      return;
    }

    event.rowNumber = await appendRow(eventToRow(event));
  });
}

async function persistRequest(request) {
  if (!sheetsConfigured()) {
    return;
  }

  await enqueueWrite(async () => {
    if (request.rowNumber) {
      await writeRow(request.rowNumber, requestToRow(request));
      return;
    }

    request.rowNumber = await appendRow(requestToRow(request));
  });
}

async function persistMatch(match) {
  if (!sheetsConfigured()) {
    return;
  }

  await enqueueWrite(async () => {
    if (match.rowNumber) {
      await writeRow(match.rowNumber, matchToRow(match));
      return;
    }

    match.rowNumber = await appendRow(matchToRow(match));
  });
}

async function upsertLfgEvent(input) {
  await ensureLoaded();

  const existing = cache.events.find(
    event => event.discordEventId === input.discordEventId
  );
  const timestamp = nowISO();

  if (existing) {
    Object.assign(existing, {
      eventName: input.eventName ?? existing.eventName,
      guildId: input.guildId ?? existing.guildId,
      format: input.format ?? existing.format,
      teamSize: input.teamSize ?? existing.teamSize,
      tierRuleId: input.tierRuleId ?? existing.tierRuleId,
      lfgEnabled:
        input.lfgEnabled === undefined ? existing.lfgEnabled : input.lfgEnabled,
      startTime: input.startTime ?? existing.startTime,
      lfgChannelId: input.lfgChannelId ?? existing.lfgChannelId,
      lfgMessageId: input.lfgMessageId ?? existing.lfgMessageId,
      excludeRoleId: input.excludeRoleId ?? existing.excludeRoleId,
      mentionEveryone:
        input.mentionEveryone === undefined
          ? existing.mentionEveryone
          : Boolean(input.mentionEveryone),
      lfgPostEnabled:
        input.lfgPostEnabled === undefined
          ? existing.lfgPostEnabled
          : Boolean(input.lfgPostEnabled),
      updatedAt: timestamp,
      createdBy: existing.createdBy || input.createdBy || ""
    });

    await persistEvent(existing);
    return existing;
  }

  const created = {
    discordEventId: input.discordEventId,
    eventName: input.eventName,
    guildId: input.guildId,
    format: input.format,
    teamSize: input.teamSize,
    tierRuleId: input.tierRuleId,
    lfgEnabled: input.lfgEnabled !== false,
    startTime: input.startTime || "",
    lfgChannelId: input.lfgChannelId || "",
    lfgMessageId: input.lfgMessageId || "",
    excludeRoleId: input.excludeRoleId || "",
    mentionEveryone: Boolean(input.mentionEveryone),
    lfgPostEnabled:
      input.lfgPostEnabled === undefined
        ? Boolean(input.lfgMessageId)
        : Boolean(input.lfgPostEnabled),
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: input.createdBy || ""
  };

  cache.events.push(created);
  await persistEvent(created);
  return created;
}

async function getLfgEvent(discordEventId) {
  await ensureLoaded();
  return (
    cache.events.find(event => event.discordEventId === discordEventId) || null
  );
}

async function listLfgEvents({ guildId, enabledOnly = false } = {}) {
  await ensureLoaded();

  return cache.events.filter(event => {
    if (guildId && event.guildId && event.guildId !== guildId) {
      return false;
    }

    if (enabledOnly && !event.lfgEnabled) {
      return false;
    }

    return Boolean(event.discordEventId);
  });
}

async function createLfgRequest(input) {
  await ensureLoaded();

  const timestamp = nowISO();
  const request = {
    id: crypto.randomUUID(),
    eventId: input.eventId,
    guildId: input.guildId,
    ownerUserId: input.ownerUserId,
    type: input.type,
    memberUserIds: input.memberUserIds,
    note: input.note || "",
    active: input.active !== false,
    dmOk: input.dmOk !== false,
    source: input.source || "lfg",
    username: input.username || "",
    loggedTier: input.loggedTier || "",
    loggedGender: input.loggedGender || "",
    acceptedTiers: Array.isArray(input.acceptedTiers)
      ? input.acceptedTiers.map(value => String(value).toUpperCase())
      : [],
    requiredGender: input.requiredGender || "",
    notifiedFillUserIds: Array.isArray(input.notifiedFillUserIds)
      ? input.notifiedFillUserIds.map(String)
      : [],
    status: String(
      input.status || (input.active !== false ? "OPEN" : "CLOSED")
    ).toUpperCase(),
    eventName: input.eventName || "",
    eventStart: input.eventStart || "",
    format: input.format || "",
    createdAt: timestamp,
    updatedAt: timestamp,
    closedAt: "",
    closedReason: ""
  };

  cache.requests.push(request);
  await persistRequest(request);
  return request;
}

async function updateLfgRequest(requestId, patch) {
  await ensureLoaded();

  const request = cache.requests.find(item => item.id === requestId);

  if (!request) {
    return null;
  }

  Object.assign(request, patch, { updatedAt: nowISO() });
  await persistRequest(request);
  return request;
}

async function getLfgRequest(requestId) {
  await ensureLoaded();
  return cache.requests.find(item => item.id === requestId) || null;
}

async function getActiveRequestForUser(eventId, ownerUserId) {
  await ensureLoaded();

  return (
    cache.requests.find(
      request =>
        request.active &&
        isLookRequest(request) &&
        request.eventId === eventId &&
        request.ownerUserId === ownerUserId
    ) || null
  );
}

async function listActiveRequests(eventId) {
  await ensureLoaded();

  return cache.requests.filter(
    request =>
      request.active &&
      isLookRequest(request) &&
      request.eventId === eventId
  );
}

async function listActiveRequestsForUser(ownerUserId, guildId) {
  await ensureLoaded();

  return cache.requests.filter(request => {
    if (!request.active || request.ownerUserId !== ownerUserId) {
      return false;
    }

    if (!isLookRequest(request)) {
      return false;
    }

    if (guildId && request.guildId && request.guildId !== guildId) {
      return false;
    }

    return true;
  });
}

async function getActivePostRequest(eventId, ownerUserId, type) {
  await ensureLoaded();

  return (
    cache.requests.find(
      request =>
        request.active &&
        request.type === type &&
        request.eventId === eventId &&
        request.ownerUserId === ownerUserId
    ) || null
  );
}

async function listOpenPostRequests(eventId, type) {
  await ensureLoaded();

  return cache.requests.filter(request => {
    if (!request.active || request.status === "CLOSED") {
      return false;
    }

    if (request.eventId !== eventId) {
      return false;
    }

    if (type) {
      return request.type === type;
    }

    return isPostFill(request) || isPostNeed(request);
  });
}

async function listOpenPostRequestsForUser(ownerUserId, guildId) {
  await ensureLoaded();

  return cache.requests.filter(request => {
    if (!request.active || request.status === "CLOSED") {
      return false;
    }

    if (request.ownerUserId !== ownerUserId) {
      return false;
    }

    if (!(isPostFill(request) || isPostNeed(request))) {
      return false;
    }

    if (guildId && request.guildId && request.guildId !== guildId) {
      return false;
    }

    return true;
  });
}

async function closeLfgRequest(requestId, reason) {
  return updateLfgRequest(requestId, {
    active: false,
    status: "CLOSED",
    closedAt: nowISO(),
    closedReason: reason || "closed"
  });
}

async function closeActiveRequestsForEvent(eventId, reason) {
  await ensureLoaded();

  const closed = [];

  for (const request of cache.requests) {
    if (!request.active || request.eventId !== eventId) {
      continue;
    }

    request.active = false;
    request.status = "CLOSED";
    request.closedAt = nowISO();
    request.closedReason = reason || "event_closed";
    request.updatedAt = nowISO();
    await persistRequest(request);
    closed.push(request);
  }

  return closed;
}

async function closePostRequestsForEvent(eventId, reason) {
  await ensureLoaded();

  const closed = [];

  for (const request of cache.requests) {
    if (
      !request.active ||
      request.eventId !== eventId ||
      !(isPostFill(request) || isPostNeed(request))
    ) {
      continue;
    }

    request.active = false;
    request.status = "CLOSED";
    request.closedAt = nowISO();
    request.closedReason = reason || "post_ended";
    request.updatedAt = nowISO();
    await persistRequest(request);
    closed.push(request);
  }

  return closed;
}

function isLfgPostOpen(event) {
  if (!event) {
    return false;
  }

  if (event.lfgPostEnabled === false) {
    return false;
  }

  return Boolean(event.lfgMessageId);
}

function matchKey(userIds) {
  return [...userIds].sort().join(",");
}

async function findMatchByUsers(eventId, userIds) {
  await ensureLoaded();
  const key = matchKey(userIds);

  return (
    cache.matches.find(
      match => match.eventId === eventId && matchKey(match.userIds) === key
    ) || null
  );
}

async function getLfgMatch(matchId) {
  await ensureLoaded();
  return cache.matches.find(item => item.id === matchId) || null;
}

async function upsertLfgMatch(input) {
  await ensureLoaded();

  const existing = await findMatchByUsers(input.eventId, input.userIds);
  const timestamp = nowISO();

  if (existing) {
    Object.assign(existing, {
      requestIds: input.requestIds || existing.requestIds,
      complete:
        input.complete === undefined ? existing.complete : input.complete,
      status: input.status || existing.status,
      updatedAt: timestamp
    });

    if (input.interestedOwnerIds) {
      existing.interestedOwnerIds = input.interestedOwnerIds;
    }

    if (input.dismissedOwnerIds) {
      existing.dismissedOwnerIds = input.dismissedOwnerIds;
    }

    if (input.notifiedOwnerIds) {
      existing.notifiedOwnerIds = input.notifiedOwnerIds;
    }

    await persistMatch(existing);
    return existing;
  }

  const created = {
    id: crypto.randomUUID(),
    eventId: input.eventId,
    requestIds: [...(input.requestIds || [])].sort(),
    userIds: [...(input.userIds || [])].sort(),
    complete: Boolean(input.complete),
    status: input.status || "proposed",
    interestedOwnerIds: input.interestedOwnerIds || [],
    dismissedOwnerIds: input.dismissedOwnerIds || [],
    notifiedOwnerIds: input.notifiedOwnerIds || [],
    createdAt: timestamp,
    updatedAt: timestamp
  };

  cache.matches.push(created);
  await persistMatch(created);
  return created;
}

async function updateLfgMatch(matchId, patch) {
  await ensureLoaded();

  const match = cache.matches.find(item => item.id === matchId);

  if (!match) {
    return null;
  }

  Object.assign(match, patch, { updatedAt: nowISO() });
  await persistMatch(match);
  return match;
}

async function listMatchesForEvent(eventId) {
  await ensureLoaded();
  return cache.matches.filter(match => match.eventId === eventId);
}

async function hasDismissedMatch(request, userIds) {
  await ensureLoaded();
  const key = matchKey(userIds);

  return cache.matches.some(
    match =>
      match.eventId === request.eventId &&
      matchKey(match.userIds) === key &&
      match.dismissedOwnerIds.includes(request.ownerUserId)
  );
}

async function hasNotifiedMatch(request, userIds) {
  await ensureLoaded();
  const key = matchKey(userIds);

  return cache.matches.some(
    match =>
      match.eventId === request.eventId &&
      matchKey(match.userIds) === key &&
      match.notifiedOwnerIds.includes(request.ownerUserId) &&
      match.status !== "dead"
  );
}

async function listKnownLfgUserIds() {
  await ensureLoaded();

  const ids = new Set();

  for (const request of cache.requests) {
    if (request.ownerUserId) {
      ids.add(String(request.ownerUserId));
    }

    for (const userId of request.notifiedFillUserIds || []) {
      ids.add(String(userId));
    }
  }

  for (const match of cache.matches) {
    for (const userId of match.userIds || []) {
      ids.add(String(userId));
    }
  }

  return ids;
}

module.exports = {
  matchKey,
  ensureLoaded,
  LOOK_REQUEST_TYPES,
  POST_FILL_TYPE,
  POST_NEED_TYPE,
  isLookRequest,
  isPostFill,
  isPostNeed,
  upsertLfgEvent,
  getLfgEvent,
  listLfgEvents,
  createLfgRequest,
  updateLfgRequest,
  getLfgRequest,
  getActiveRequestForUser,
  listActiveRequests,
  listActiveRequestsForUser,
  getActivePostRequest,
  listOpenPostRequests,
  listOpenPostRequestsForUser,
  closeLfgRequest,
  closeActiveRequestsForEvent,
  closePostRequestsForEvent,
  isLfgPostOpen,
  findMatchByUsers,
  getLfgMatch,
  upsertLfgMatch,
  updateLfgMatch,
  listMatchesForEvent,
  hasDismissedMatch,
  hasNotifiedMatch,
  listKnownLfgUserIds
};
