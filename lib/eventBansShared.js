const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
const {
  buildBansMessage,
  normalizeBans,
  extraBansOnly,
  formatListInput
} = require("./rulesTemplate");
const {
  getEvent,
  setEvent,
  listEventsInChannel,
  findEventByBansMessageId,
  listPacksForScheduledEvent
} = require("./rulesStore");
const {
  PACK_TYPES,
  upsertRulesPost,
  listPostsForScheduledEvent,
  findPostByBansMessageId
} = require("./rulesPostsSheet");
const {
  listSuggestions,
  rememberRulesSuggestions,
  buildSuggestionSelectRow,
  TYPES
} = require("./rulesSuggestionsSheet");

const BANS_MESSAGE_MARKER = "## 🚫  BANNED ITEMS  🚫";
const editBanPickCache = new Map();

const DEFAULT_BAN_ALWAYS_LINE =
  "Sniper/explosive ammo is always banned — you do not need to list it below.";

const BAN_LIST_EDIT_HINT =
  "**Edit ban list** — paste extras (one per line; replaces the list). " +
  "**+ Add one** or saved — add a single item.";

function formatBansPanelDescription(introLine) {
  return `${introLine}\n\n-# ${DEFAULT_BAN_ALWAYS_LINE}\n${BAN_LIST_EDIT_HINT}`;
}

function sanitizeKey(raw) {
  return (raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function deriveBansOnlyKey({ scheduledEventId, eventName, channelId }) {
  if (scheduledEventId) {
    return sanitizeKey(`${scheduledEventId}-bans`) || "event-bans";
  }

  if (channelId) {
    return sanitizeKey(`${channelId}-bans`) || "channel-bans";
  }

  return sanitizeKey(`${eventName}-bans`) || "event-bans";
}

function appendUniqueStrings(list, items) {
  const out = [...(Array.isArray(list) ? list : [])];
  const seen = new Set(out.map(item => item.toLowerCase()));

  for (const raw of items || []) {
    const item = (raw || "").trim();

    if (!item) {
      continue;
    }

    const key = item.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    out.push(item);
  }

  return out;
}

function saveTypedSuggestionsToLibrary(guildId, { bans = [], rules = [] } = {}) {
  if (!guildId) {
    return;
  }

  rememberRulesSuggestions(guildId, {
    bans: extraBansOnly(normalizeBans(bans)),
    rules: Array.isArray(rules) ? rules : []
  });
}

function parseBansFromMessageContent(content) {
  const lines = (content || "").split("\n");
  const bans = [];
  let collecting = false;

  for (const line of lines) {
    if (line.includes("BANNED ITEMS")) {
      collecting = true;
      continue;
    }

    if (collecting && line.startsWith("-#")) {
      break;
    }

    if (collecting && line.startsWith("- ")) {
      bans.push(line.slice(2).trim());
    }
  }

  return normalizeBans(bans);
}

async function fetchBansMessage(client, eventRecord) {
  if (!eventRecord?.bansMessageId || !eventRecord?.channelId) {
    return null;
  }

  const channel = await client.channels
    .fetch(eventRecord.channelId)
    .catch(() => null);

  if (!channel?.isTextBased?.()) {
    return null;
  }

  return channel.messages.fetch(eventRecord.bansMessageId).catch(() => null);
}

async function clearBansMessageTracking(guildId, key) {
  const record = getEvent(guildId, key);

  if (!record?.bansMessageId) {
    return;
  }

  setEvent(guildId, key, { bansMessageId: "" });

  await recordPostedPackToSheet({
    guildId,
    key,
    scheduledEventId: record.scheduledEventId,
    packType: record.packType,
    mode: record.mode,
    eventName: record.eventName,
    channelId: record.channelId,
    rulesMessageId: record.rulesMessageId,
    bansMessageId: "",
    postedAt: record.createdAt
  });
}

async function verifyChannelPack(client, guildId, pack) {
  const bansMessage = await fetchBansMessage(client, pack);

  if (bansMessage) {
    return { key: pack.key, eventRecord: pack };
  }

  if (pack.bansMessageId) {
    await clearBansMessageTracking(guildId, pack.key);
  }

  return null;
}

async function handleBansMessageDeleted(message) {
  const guildId = message.guildId;
  const messageId = message.id;

  if (!guildId || !messageId) {
    return false;
  }

  const matched =
    findEventByBansMessageId(guildId, messageId) ||
    (await findPostByBansMessageId(guildId, messageId));

  if (!matched?.key) {
    return false;
  }

  await clearBansMessageTracking(guildId, matched.key);
  console.log(
    `[BANS] Cleared tracking — bans message deleted (${messageId}) key=${matched.key}`
  );

  return true;
}

const BANS_MESSAGE_DELETED_ERR = "bans_message_deleted";

function bansMessageDeletedUserMessage(eventName) {
  return (
    `The **banned items** message for **${eventName || "this event"}** was deleted.\n\n` +
    "Post again with `/rules form` or `/bans post`, or run `/bans edit` if another bans message is still in the channel."
  );
}

async function resolveBansTargetInChannel(interaction) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;
  const client = interaction.client;
  const channelEvents = listEventsInChannel(guildId, channelId);
  let lastDeletedPack = null;

  for (const pack of channelEvents) {
    const verified = await verifyChannelPack(client, guildId, pack);

    if (verified) {
      if (channelEvents.length > 1) {
        return { ...verified, multipleInChannel: channelEvents.length };
      }

      return verified;
    }

    lastDeletedPack = pack;
  }

  if (!interaction.channel?.isTextBased?.()) {
    if (lastDeletedPack && channelEvents.length === 1) {
      return {
        key: lastDeletedPack.key,
        eventRecord: lastDeletedPack,
        bansMessageDeleted: true
      };
    }

    return null;
  }

  const messages = await interaction.channel.messages
    .fetch({ limit: 50 })
    .catch(() => null);

  if (!messages) {
    return null;
  }

  const botId = interaction.client.user.id;
  const bansMessage = [...messages.values()]
    .filter(
      message =>
        message.author.id === botId &&
        message.content.includes(BANS_MESSAGE_MARKER)
    )
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];

  if (!bansMessage) {
    if (lastDeletedPack && channelEvents.length === 1) {
      return {
        key: lastDeletedPack.key,
        eventRecord: lastDeletedPack,
        bansMessageDeleted: true
      };
    }

    return null;
  }

  let matched = findEventByBansMessageId(guildId, bansMessage.id);

  if (!matched) {
    try {
      const sheetPost = await findPostByBansMessageId(
        guildId,
        bansMessage.id
      );

      if (sheetPost) {
        matched = {
          key: sheetPost.key,
          ...sheetPost
        };
      }
    } catch (err) {
      console.error("[RULES POSTS SHEET] resolve channel:", err?.message || err);
    }
  }

  if (matched) {
    const { key, ...eventRecord } = matched;

    setEvent(guildId, key, {
      ...eventRecord,
      bansMessageId: bansMessage.id,
      channelId
    });

    return { key, eventRecord: { ...eventRecord, bansMessageId: bansMessage.id, channelId } };
  }

  const key = sanitizeKey(bansMessage.id);
  const bans = parseBansFromMessageContent(bansMessage.content);
  const eventRecord = {
    key,
    eventName: "Banned items",
    bans,
    channelId,
    bansMessageId: bansMessage.id,
    createdAt: bansMessage.createdAt?.toISOString?.() || new Date().toISOString()
  };

  setEvent(guildId, key, eventRecord);

  return {
    key,
    eventRecord,
    recoveredFromMessage: true
  };
}

async function applyBansUpdate(interaction, guildId, key, nextBans) {
  const eventRecord = getEvent(guildId, key);

  if (!eventRecord) {
    throw new Error("missing_event");
  }

  const normalized = normalizeBans(nextBans);
  const channel = await interaction.client.channels
    .fetch(eventRecord.channelId)
    .catch(() => null);

  if (!channel?.isTextBased?.()) {
    throw new Error(BANS_MESSAGE_DELETED_ERR);
  }

  let bansMessage = await fetchBansMessage(
    interaction.client,
    eventRecord
  );

  if (!bansMessage) {
    if (eventRecord.bansMessageId) {
      await clearBansMessageTracking(guildId, key);
    }

    bansMessage = await channel.send({
      content: buildBansMessage({ bans: normalized }),
      allowedMentions: { parse: [] }
    });

    setEvent(guildId, key, {
      bansMessageId: bansMessage.id,
      channelId: channel.id
    });
  } else {
    await bansMessage.edit({
      content: buildBansMessage({ bans: normalized }),
      allowedMentions: { parse: [] }
    });
  }

  setEvent(guildId, key, { bans: normalized });

  const updated = getEvent(guildId, key);

  if (updated) {
    await recordPostedPackToSheet({
      guildId,
      key,
      scheduledEventId: updated.scheduledEventId,
      packType: updated.packType || (updated.rulesMessageId ? PACK_TYPES.RULES : PACK_TYPES.BANS_ONLY),
      mode: updated.mode,
      eventName: updated.eventName,
      channelId: updated.channelId,
      rulesMessageId: updated.rulesMessageId,
      bansMessageId: updated.bansMessageId,
      postedAt: updated.createdAt
    });
  }

  saveTypedSuggestionsToLibrary(guildId, {
    bans: extraBansOnly(normalized)
  });

  return normalized;
}

function parseBansListText(input) {
  if (!input?.trim()) {
    return [];
  }

  const seen = new Set();
  const out = [];

  for (const rawPart of input.split(/\n|,/g)) {
    const item = rawPart.trim();
    const lower = item.toLowerCase();

    if (!item || seen.has(lower)) {
      continue;
    }

    seen.add(lower);
    out.push(item);
  }

  return out;
}

function parseBansModalInput(fields) {
  const listRaw = fields.getTextInputValue("bans_list");

  if (listRaw !== null && listRaw !== undefined) {
    return { lines: parseBansListText(listRaw) };
  }

  const lines = [];

  for (let i = 1; i <= 5; i++) {
    lines.push(fields.getTextInputValue(`ban_${i}`)?.trim() || "");
  }

  return { lines: lines.filter(Boolean) };
}

function buildBansFromExtraLines(lines) {
  return normalizeBans(lines);
}

function formatBansEmbedValue(extraBans) {
  if (!extraBans?.length) {
    return "_No extra bans in your list yet._";
  }

  const header = `**${extraBans.length}** extra item(s):\n`;
  const body = extraBans.map(item => `• ${item}`).join("\n");

  return (header + body).slice(0, 1024);
}

function buildBanFormModal(customId, title, extraBans = []) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle((title || "Ban list").slice(0, 45));

  const input = new TextInputBuilder()
    .setCustomId("bans_list")
    .setLabel("Extra bans (replaces list)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setPlaceholder(
      "Replaces your extra list. Leave empty to clear extras.\n\n" +
        "One per line or comma-separated:\nHeavy Sniper\nRocket Launcher"
    );

  const value = formatListInput(extraBansOnly(extraBans));

  if (value) {
    input.setValue(value.slice(0, 4000));
  }

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function showBansFormModal(interaction, prefix, key, extraBans = []) {
  return interaction.showModal(
    buildBanFormModal(
      `${prefix}_bans_form:${key}`,
      "Edit ban list",
      extraBans
    )
  );
}

function showAddBanLineModal(interaction, prefix, key) {
  const modal = new ModalBuilder()
    .setCustomId(`${prefix}_add_ban:${key}`)
    .setTitle("Quick add");

  const input = new TextInputBuilder()
    .setCustomId("new_ban")
    .setLabel("One banned item")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

function showPendingAddBanModal(interaction, prefix, token) {
  const modal = new ModalBuilder()
    .setCustomId(`${prefix}_pending_add_ban:${token}`)
    .setTitle("Quick add");

  const input = new TextInputBuilder()
    .setCustomId("new_ban")
    .setLabel("One banned item")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

function buildBanEditEmbed(eventRecord, { footerNote } = {}) {
  const extraBans = extraBansOnly(eventRecord.bans);

  const embed = new EmbedBuilder()
    .setTitle(`Ban list — ${eventRecord.eventName}`)
    .setDescription(
      formatBansPanelDescription(
        "Changes update the **Banned items** post in this channel."
      )
    )
    .setColor(0xed4245)
    .addFields({
      name: "Extra bans (preview)",
      value: formatBansEmbedValue(extraBans)
    });

  if (footerNote) {
    embed.setFooter({ text: footerNote.slice(0, 2048) });
  }

  return embed;
}

function buildBansEditorFooterNotes({ multipleInChannel, recoveredFromMessage } = {}) {
  const parts = [];

  if (multipleInChannel > 1) {
    parts.push(
      `${multipleInChannel} ban lists in this channel — showing the most recent.`
    );
  }

  if (recoveredFromMessage) {
    parts.push("Linked from the bans message in this channel.");
  }

  return parts.join(" ");
}

async function acknowledgeSlashSilently(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  await interaction.deleteReply().catch(() => {});
}

async function acknowledgeButtonSilently(interaction) {
  if (interaction.deferred || interaction.replied) {
    return;
  }

  try {
    await interaction.deferUpdate();
  } catch {
    await acknowledgeSlashSilently(interaction);
  }
}

function buildEphemeralBanEditRow(prefix, token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_edit_ephemeral:${token}`)
      .setLabel("Edit ban list")
      .setStyle(ButtonStyle.Primary)
  );
}

function buildAddBanLineRow(prefix, key, { showDismiss = false } = {}) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`${prefix}_edit_bans:${key}`)
      .setLabel("Edit ban list")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${prefix}_add_ban:${key}`)
      .setLabel("+ Add one")
      .setStyle(ButtonStyle.Secondary)
  ];

  if (showDismiss) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${prefix}_dismiss:${key}`)
        .setLabel("Dismiss")
        .setStyle(ButtonStyle.Secondary)
    );
  }

  return new ActionRowBuilder().addComponents(...buttons);
}

async function buildBanEditComponents(prefix, key, guildId, options = {}) {
  const rows = [buildAddBanLineRow(prefix, key, options)];

  try {
    const savedBans = await listSuggestions(guildId, TYPES.BAN);
    editBanPickCache.set(`${prefix}:${key}`, savedBans);

    const banPick = buildSuggestionSelectRow({
      customId: `${prefix}_saved_ban_edit:${key}`,
      placeholder: "Recents…",
      items: savedBans
    });

    if (banPick) {
      rows.unshift(banPick.row);
    }
  } catch (err) {
    console.error("[BANS LIBRARY] edit panel:", err?.message || err);
  }

  return rows.slice(0, 5);
}

async function postBansOnlyPack(interaction, payload) {
  const { key, scheduledEventId, eventName, eventDateTime, bans } = payload;

  await assertCanPostBansOnlyPack(interaction.guildId, {
    scheduledEventId,
    eventName,
    channelId: interaction.channelId
  });

  const normalized = normalizeBans(bans);
  const bansMessage = await interaction.channel.send({
    content: buildBansMessage({ bans: normalized }),
    allowedMentions: { parse: [] }
  });
  const createdAt = new Date().toISOString();

  setEvent(interaction.guildId, key, {
    key,
    packType: PACK_TYPES.BANS_ONLY,
    scheduledEventId,
    eventName,
    eventDateTime,
    bans: normalized,
    channelId: interaction.channelId,
    bansMessageId: bansMessage.id,
    createdAt
  });

  await recordPostedPackToSheet({
    guildId: interaction.guildId,
    key,
    scheduledEventId,
    packType: PACK_TYPES.BANS_ONLY,
    eventName,
    channelId: interaction.channelId,
    bansMessageId: bansMessage.id,
    postedAt: createdAt
  });

  saveTypedSuggestionsToLibrary(interaction.guildId, {
    bans: extraBansOnly(normalized)
  });

  return key;
}

function getPendingExtraBans(context) {
  const source = context.pendingBans ?? context.extraBans ?? [];
  return extraBansOnly(normalizeBans(source));
}

function packCompletenessScore(pack) {
  return (
    (pack.bansMessageId ? 8 : 0) +
    (pack.rulesMessageId ? 4 : 0) +
    (pack.channelId ? 2 : 0) +
    (pack.eventName ? 1 : 0)
  );
}

function mergeEventPacks(localPacks, sheetPacks) {
  const byKey = new Map();

  for (const pack of [...localPacks, ...sheetPacks]) {
    if (!pack?.key || !pack.bansMessageId) {
      continue;
    }

    const existing = byKey.get(pack.key);

    if (
      !existing ||
      packCompletenessScore(pack) > packCompletenessScore(existing)
    ) {
      byKey.set(pack.key, pack);
    }
  }

  return [...byKey.values()].sort((a, b) =>
    (b.updatedAt || b.postedAt || b.createdAt || "").localeCompare(
      a.updatedAt || a.postedAt || a.createdAt || ""
    )
  );
}

async function findExistingBansForScheduledEvent(guildId, scheduledEventId) {
  const localPacks = listPacksForScheduledEvent(guildId, scheduledEventId);
  let sheetPacks = [];

  try {
    sheetPacks = await listPostsForScheduledEvent(guildId, scheduledEventId);
  } catch (err) {
    console.error(
      "[RULES POSTS SHEET] findExistingBansForScheduledEvent:",
      err?.message || err
    );
  }

  return mergeEventPacks(localPacks, sheetPacks);
}

function buildBansPostBlockedMessage(existingPacks, eventName, { channelOnly } = {}) {
  if (!existingPacks?.length) {
    return null;
  }

  const rulesPack = existingPacks.find(
    pack => pack.rulesMessageId || pack.packType === PACK_TYPES.RULES
  );

  if (rulesPack) {
    const channelHint = rulesPack.channelId
      ? ` in <#${rulesPack.channelId}>`
      : "";

    if (channelOnly) {
      return (
        "Rules and bans were already posted in this channel with `/rules form`.\n\n" +
        "Use `/rules bans` or `/bans edit` here to edit them."
      );
    }

    return (
      `Banned items for **${eventName}** were already posted with \`/rules form\`${channelHint}.\n\n` +
      "Use `/rules bans` or `/bans edit` there to edit them — you cannot post a separate bans message for this event."
    );
  }

  const bansPack = existingPacks[0];
  const channelHint = bansPack.channelId
    ? ` in <#${bansPack.channelId}>`
    : "";

  if (channelOnly) {
    return (
      "Banned items are already posted in this channel.\n\n" +
      "Use `/bans edit` here to change them."
    );
  }

  return (
    `Banned items for **${eventName}** are already posted${channelHint}.\n\n` +
    "Use `/bans edit` there to change them."
  );
}

async function assertCanPostBansOnlyPack(
  guildId,
  { scheduledEventId, eventName, channelId } = {}
) {
  let existing = [];

  if (scheduledEventId) {
    existing = await findExistingBansForScheduledEvent(guildId, scheduledEventId);
  } else if (channelId) {
    existing = listEventsInChannel(guildId, channelId);
  }

  const message = buildBansPostBlockedMessage(existing, eventName, {
    channelOnly: !scheduledEventId
  });

  if (message) {
    const error = new Error("bans_already_posted");
    error.userMessage = message;
    throw error;
  }
}

async function recordPostedPackToSheet(post) {
  try {
    await upsertRulesPost(post);
  } catch (err) {
    console.error("[RULES POSTS SHEET] record:", err?.message || err);
  }
}

async function acknowledgeSelectSilently(interaction) {
  if (interaction.deferred || interaction.replied) {
    return;
  }

  await interaction.deferUpdate();
}

async function acknowledgeModalSilently(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  await interaction.deleteReply().catch(() => {});
}

async function replyModalError(interaction, message) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content: message });
  }

  return interaction.reply({ content: message, ephemeral: true });
}

module.exports = {
  BANS_MESSAGE_MARKER,
  editBanPickCache,
  sanitizeKey,
  deriveBansOnlyKey,
  appendUniqueStrings,
  saveTypedSuggestionsToLibrary,
  parseBansFromMessageContent,
  resolveBansTargetInChannel,
  applyBansUpdate,
  parseBansModalInput,
  buildBansFromExtraLines,
  formatBansEmbedValue,
  buildBanFormModal,
  showBansFormModal,
  showAddBanLineModal,
  showPendingAddBanModal,
  buildBanEditEmbed,
  buildBanEditComponents,
  buildEphemeralBanEditRow,
  buildAddBanLineRow,
  postBansOnlyPack,
  getPendingExtraBans,
  getEvent,
  setEvent,
  findExistingBansForScheduledEvent,
  buildBansPostBlockedMessage,
  assertCanPostBansOnlyPack,
  recordPostedPackToSheet,
  acknowledgeSelectSilently,
  acknowledgeModalSilently,
  acknowledgeSlashSilently,
  acknowledgeButtonSilently,
  replyModalError,
  formatBansPanelDescription,
  DEFAULT_BAN_ALWAYS_LINE,
  buildBansEditorFooterNotes,
  handleBansMessageDeleted,
  BANS_MESSAGE_DELETED_ERR,
  bansMessageDeletedUserMessage
};
