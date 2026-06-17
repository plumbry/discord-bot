const { PermissionFlagsBits } = require("discord.js");
const { getSheets } = require("./sheets");

const SHEET_ID = process.env.MAIN_SHEET_ID;
const REACTS_RANGE = "Reacts!A:K";
const CACHE_TTL_MS = 2 * 60 * 1000;
const panelCache = new Map();

function panelCacheKey(guildId, messageId) {
  return `${guildId}:${messageId}`;
}

function cachePanel(guildId, messageId, panel) {
  panelCache.set(panelCacheKey(guildId, messageId), {
    panel,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

function getCachedPanel(guildId, messageId) {
  const entry = panelCache.get(panelCacheKey(guildId, messageId));
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt < Date.now()) {
    panelCache.delete(panelCacheKey(guildId, messageId));
    return undefined;
  }

  return entry.panel;
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

function assertSheetConfigured() {
  if (!SHEET_ID) {
    throw new Error("MAIN_SHEET_ID is not configured");
  }
}

function panelFromRow(row) {
  return {
    guildId: row[0],
    messageId: row[1],
    channelId: row[2],
    mappings: JSON.parse(row[3] || "{}"),
    exclusive: parseBool(row[4], false),
    removeOnUnreact: parseBool(row[5], true),
    createdBy: row[6] || "",
    createdAt: row[7] || "",
    updatedBy: row[8] || "",
    updatedAt: row[9] || "",
    active: !row[10] || String(row[10]).toLowerCase() === "active"
  };
}

function parseEmojiInput(input) {
  if (!input?.trim()) {
    return null;
  }

  const trimmed = input.trim();
  const customMatch = trimmed.match(/^<a?:(\w+):(\d+)>$/);

  if (customMatch) {
    return {
      id: customMatch[2],
      name: customMatch[1],
      animated: trimmed.startsWith("<a:")
    };
  }

  if (/^\d{17,20}$/.test(trimmed)) {
    return { id: trimmed };
  }

  return { name: trimmed };
}

function emojiKey(emoji) {
  return emoji.id || emoji.name;
}

function emojiReactArg(parsed) {
  if (parsed.id) {
    return parsed.id;
  }

  return parsed.name;
}

function formatEmojiLabel(parsed) {
  if (parsed.id && parsed.name) {
    return `<${parsed.animated ? "a" : ""}:${parsed.name}:${parsed.id}>`;
  }

  if (parsed.id) {
    return parsed.id;
  }

  return parsed.name;
}

function canBotManageRole(guild, role) {
  const me = guild.members.me;

  if (!me) {
    return false;
  }

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return false;
  }

  if (role.managed) {
    return false;
  }

  if (role.id === guild.id) {
    return false;
  }

  return role.position < me.roles.highest.position;
}

async function getAllSheetRows() {
  assertSheetConfigured();
  const response = await getSheets().spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: REACTS_RANGE
  });

  return response.data.values || [];
}

async function findPanelRowIndex(guildId, messageId) {
  const rows = await getAllSheetRows();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[0] === guildId && row[1] === messageId) {
      return { rowIndex: i + 1, row };
    }
  }

  return null;
}

async function ensureHeaderRow() {
  await ensureReactsSheetTab();
  const rows = await getAllSheetRows();
  if (rows.length > 0) {
    return;
  }

  await getSheets().spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: "Reacts!A1:K1",
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        "guildId",
        "messageId",
        "channelId",
        "mappingsJson",
        "exclusive",
        "removeOnUnreact",
        "createdBy",
        "createdAt",
        "updatedBy",
        "updatedAt",
        "status"
      ]]
    }
  });
}

async function ensureReactsSheetTab() {
  assertSheetConfigured();
  const metadata = await getSheets().spreadsheets.get({
    spreadsheetId: SHEET_ID
  });

  const hasTab = (metadata.data.sheets || []).some(
    sheet => sheet.properties?.title === "Reacts"
  );

  if (hasTab) {
    return;
  }

  await getSheets().spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: "Reacts"
            }
          }
        }
      ]
    }
  });
}

function panelToRow(guildId, messageId, panel, { keepCreated = null } = {}) {
  const now = new Date().toISOString();
  const createdAt = keepCreated?.createdAt || panel.createdAt || now;
  const createdBy = keepCreated?.createdBy || panel.createdBy || panel.updatedBy || "";

  return [
    guildId,
    messageId,
    panel.channelId || "",
    JSON.stringify(panel.mappings || {}),
    String(Boolean(panel.exclusive)),
    String(panel.removeOnUnreact !== false),
    createdBy,
    createdAt,
    panel.updatedBy || panel.createdBy || "",
    panel.updatedAt || now,
    panel.active === false ? "inactive" : "active"
  ];
}

async function savePanel(guildId, messageId, panel) {
  await ensureHeaderRow();
  const match = await findPanelRowIndex(guildId, messageId);
  const row = panelToRow(guildId, messageId, panel, {
    keepCreated: match ? panelFromRow(match.row) : null
  });

  if (match) {
    await getSheets().spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `Reacts!A${match.rowIndex}:K${match.rowIndex}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] }
    });
  } else {
    await getSheets().spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: REACTS_RANGE,
      valueInputOption: "RAW",
      requestBody: { values: [row] }
    });
  }

  const stored = {
    ...panel,
    active: panel.active !== false
  };
  cachePanel(guildId, messageId, stored);
  return stored;
}

async function getPanel(guildId, messageId) {
  const cached = getCachedPanel(guildId, messageId);
  if (cached !== undefined) {
    return cached;
  }

  let match;
  try {
    match = await findPanelRowIndex(guildId, messageId);
  } catch (err) {
    console.error("[REACTION ROLES] getPanel read failed:", err?.message || err);
    return null;
  }
  if (!match) {
    cachePanel(guildId, messageId, null);
    return null;
  }

  const parsed = panelFromRow(match.row);
  if (!parsed.active) {
    cachePanel(guildId, messageId, null);
    return null;
  }

  const panel = {
    channelId: parsed.channelId,
    mappings: parsed.mappings,
    exclusive: parsed.exclusive,
    removeOnUnreact: parsed.removeOnUnreact,
    createdBy: parsed.createdBy,
    createdAt: parsed.createdAt,
    updatedBy: parsed.updatedBy,
    updatedAt: parsed.updatedAt
  };

  cachePanel(guildId, messageId, panel);
  return panel;
}

async function removePanel(guildId, messageId) {
  let match;
  try {
    match = await findPanelRowIndex(guildId, messageId);
  } catch (err) {
    console.error("[REACTION ROLES] removePanel read failed:", err?.message || err);
    return false;
  }
  if (!match) {
    cachePanel(guildId, messageId, null);
    return false;
  }

  const existing = panelFromRow(match.row);
  const row = panelToRow(guildId, messageId, {
    channelId: existing.channelId,
    mappings: existing.mappings,
    exclusive: existing.exclusive,
    removeOnUnreact: existing.removeOnUnreact,
    createdBy: existing.createdBy,
    createdAt: existing.createdAt,
    updatedBy: "",
    updatedAt: new Date().toISOString(),
    active: false
  }, {
    keepCreated: existing
  });

  await getSheets().spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `Reacts!A${match.rowIndex}:K${match.rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [row] }
  });

  cachePanel(guildId, messageId, null);
  return true;
}

async function assignReactionRole(member, roleId, panel) {
  const role = member.guild.roles.cache.get(roleId)
    || await member.guild.roles.fetch(roleId).catch(() => null);

  if (!role || !canBotManageRole(member.guild, role)) {
    return { ok: false, reason: "role_unmanageable" };
  }

  if (panel.exclusive) {
    const otherRoleIds = Object.values(panel.mappings).filter(
      id => id !== roleId
    );

    for (const otherRoleId of otherRoleIds) {
      if (member.roles.cache.has(otherRoleId)) {
        await member.roles.remove(otherRoleId).catch(err => {
          console.error("[REACTION ROLES] exclusive remove failed:", err);
        });
      }
    }
  }

  if (member.roles.cache.has(role.id)) {
    return { ok: true, noop: true };
  }

  await member.roles.add(role);
  return { ok: true, noop: false };
}

async function removeReactionRole(member, roleId) {
  const role = member.guild.roles.cache.get(roleId)
    || await member.guild.roles.fetch(roleId).catch(() => null);

  if (!role || !canBotManageRole(member.guild, role)) {
    return { ok: false, reason: "role_unmanageable" };
  }

  if (!member.roles.cache.has(role.id)) {
    return { ok: true, noop: true };
  }

  await member.roles.remove(role);
  return { ok: true, noop: false };
}

async function handleReactionAdd(reaction, user) {
  if (user.bot) {
    return;
  }

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }

  const message = reaction.message;

  if (message.partial) {
    await message.fetch().catch(() => null);
  }

  const guild = message.guild;

  if (!guild) {
    return;
  }

  const panel = await getPanel(guild.id, message.id);

  if (!panel) {
    return;
  }

  const roleId = panel.mappings[emojiKey(reaction.emoji)];

  if (!roleId) {
    return;
  }

  const member = await guild.members.fetch(user.id).catch(() => null);

  if (!member) {
    return;
  }

  try {
    await assignReactionRole(member, roleId, panel);
  } catch (err) {
    console.error("[REACTION ROLES] add failed:", err);
  }
}

async function handleReactionRemove(reaction, user) {
  if (user.bot) {
    return;
  }

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }

  const message = reaction.message;

  if (message.partial) {
    await message.fetch().catch(() => null);
  }

  const guild = message.guild;

  if (!guild) {
    return;
  }

  const panel = await getPanel(guild.id, message.id);

  if (!panel || panel.removeOnUnreact === false) {
    return;
  }

  const roleId = panel.mappings[emojiKey(reaction.emoji)];

  if (!roleId) {
    return;
  }

  const member = await guild.members.fetch(user.id).catch(() => null);

  if (!member) {
    return;
  }

  try {
    await removeReactionRole(member, roleId);
  } catch (err) {
    console.error("[REACTION ROLES] remove failed:", err);
  }
}

async function handleMessageDelete(message) {
  const guildId = message.guild?.id || message.guildId;

  if (!guildId || !message.id) {
    return;
  }

  await removePanel(guildId, message.id);
}

module.exports = {
  parseEmojiInput,
  emojiKey,
  emojiReactArg,
  formatEmojiLabel,
  canBotManageRole,
  savePanel,
  getPanel,
  removePanel,
  handleReactionAdd,
  handleReactionRemove,
  handleMessageDelete
};
