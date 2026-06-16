const fs = require("fs");
const path = require("path");
const { PermissionFlagsBits } = require("discord.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_PATH = path.join(DATA_DIR, "reactionRoles.json");

function ensureStateFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STATE_PATH)) {
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify({ panelsByGuild: {} }, null, 2),
      "utf8"
    );
  }
}

function loadState() {
  ensureStateFile();

  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return { panelsByGuild: {} };
    }

    if (
      !parsed.panelsByGuild ||
      typeof parsed.panelsByGuild !== "object"
    ) {
      parsed.panelsByGuild = {};
    }

    return parsed;
  } catch (err) {
    console.error("[REACTION ROLES] Failed reading state:", err);
    return { panelsByGuild: {} };
  }
}

function saveState(state) {
  ensureStateFile();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function getGuildPanels(state, guildId) {
  if (!state.panelsByGuild[guildId]) {
    state.panelsByGuild[guildId] = {};
  }

  return state.panelsByGuild[guildId];
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

function savePanel(guildId, messageId, panel) {
  const state = loadState();
  const panels = getGuildPanels(state, guildId);
  panels[messageId] = panel;
  saveState(state);
  return panel;
}

function getPanel(guildId, messageId) {
  const state = loadState();
  return state.panelsByGuild[guildId]?.[messageId] || null;
}

function removePanel(guildId, messageId) {
  const state = loadState();
  const panels = state.panelsByGuild[guildId];

  if (!panels?.[messageId]) {
    return false;
  }

  delete panels[messageId];

  if (!Object.keys(panels).length) {
    delete state.panelsByGuild[guildId];
  }

  saveState(state);
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

  const panel = getPanel(guild.id, message.id);

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

  const panel = getPanel(guild.id, message.id);

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

function handleMessageDelete(message) {
  const guildId = message.guild?.id || message.guildId;

  if (!guildId || !message.id) {
    return;
  }

  removePanel(guildId, message.id);
}

module.exports = {
  STATE_PATH,
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
