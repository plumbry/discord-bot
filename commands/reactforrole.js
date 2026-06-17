const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require("discord.js");

const {
  parseEmojiInput,
  emojiReactArg,
  formatEmojiLabel,
  canBotManageRole,
  savePanel,
  getPanel,
  removePanel
} = require("../lib/reactionRoles");

const TEXT_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread
]);

const REACT_DELAY_MS = 250;
const MAX_PAIRS = 5;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function collectEmojiRolePairs(interaction, { requireAtLeastOne = true } = {}) {
  const pairs = [];

  for (let index = 1; index <= MAX_PAIRS; index++) {
    const emojiRaw = interaction.options.getString(`emoji${index}`);
    const role = interaction.options.getRole(`role${index}`);

    if (!emojiRaw && !role) {
      continue;
    }

    if (!emojiRaw || !role) {
      return {
        ok: false,
        error: `Pair ${index} needs both emoji${index} and role${index}.`
      };
    }

    const parsed = parseEmojiInput(emojiRaw);

    if (!parsed) {
      return {
        ok: false,
        error: `Could not parse emoji${index}: ${emojiRaw}`
      };
    }

    pairs.push({ parsed, role });
  }

  if (!pairs.length && requireAtLeastOne) {
    return {
      ok: false,
      error: "Add at least one emoji and role pair (emoji1 + role1)."
    };
  }

  const seenEmoji = new Set();
  const seenRole = new Set();

  for (const { parsed, role } of pairs) {
    const emojiLabel = formatEmojiLabel(parsed);

    if (seenEmoji.has(emojiLabel)) {
      return {
        ok: false,
        error: `Duplicate emoji: ${emojiLabel}`
      };
    }

    seenEmoji.add(emojiLabel);

    if (seenRole.has(role.id)) {
      return {
        ok: false,
        error: `Duplicate role: ${role.name}`
      };
    }

    seenRole.add(role.id);
  }

  return { ok: true, pairs };
}

function canPostInChannel(channel) {
  if (!channel?.isTextBased?.()) {
    return { ok: false, error: "That channel cannot receive messages." };
  }

  const me = channel.guild?.members?.me;
  const perms = me ? channel.permissionsFor(me) : null;

  if (perms && !perms.has(PermissionFlagsBits.SendMessages)) {
    return {
      ok: false,
      error: `I don't have **Send Messages** in <#${channel.id}>.`
    };
  }

  if (perms && !perms.has(PermissionFlagsBits.AddReactions)) {
    return {
      ok: false,
      error: `I don't have **Add Reactions** in <#${channel.id}>.`
    };
  }

  return { ok: true, channel };
}

function parseMessageId(raw) {
  const idMatch = raw.trim().match(/(\d{17,20})/);
  return idMatch ? idMatch[1] : null;
}

function buildMappingsAndSummaryLines(pairs) {
  const mappings = {};
  const summaryLines = [];

  for (const { parsed, role } of pairs) {
    mappings[parsed.id || parsed.name] = role.id;
    summaryLines.push(`${formatEmojiLabel(parsed)} → ${role}`);
  }

  return { mappings, summaryLines };
}

async function applyMessageReactions(message, pairs) {
  try {
    await message.reactions.removeAll();
  } catch (err) {
    console.error("[REACTFORROLE] removeAll reactions failed:", err);
  }

  for (const { parsed } of pairs) {
    await message.react(emojiReactArg(parsed));
    await delay(REACT_DELAY_MS);
  }
}

function addRequiredPairOption(subcommand) {
  return subcommand
    .addStringOption(option =>
      option
        .setName("emoji1")
        .setDescription("Emoji to react with (unicode or custom)")
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName("role1")
        .setDescription("Role granted for emoji1")
        .setRequired(true)
    );
}

function addOptionalPairOptions(subcommand) {
  for (let index = 2; index <= MAX_PAIRS; index++) {
    subcommand
      .addStringOption(option =>
        option
          .setName(`emoji${index}`)
          .setDescription(`Optional emoji ${index}`)
          .setRequired(false)
      )
      .addRoleOption(option =>
        option
          .setName(`role${index}`)
          .setDescription(`Optional role for emoji${index}`)
          .setRequired(false)
      );
  }

  return subcommand;
}

function addAllOptionalPairOptions(subcommand) {
  for (let index = 1; index <= MAX_PAIRS; index++) {
    subcommand
      .addStringOption(option =>
        option
          .setName(`emoji${index}`)
          .setDescription(
            index === 1
              ? "Optional emoji 1"
              : `Optional emoji ${index}`
          )
          .setRequired(false)
      )
      .addRoleOption(option =>
        option
          .setName(`role${index}`)
          .setDescription(
            index === 1
              ? "Optional role for emoji1"
              : `Optional role for emoji${index}`
          )
          .setRequired(false)
      );
  }

  return subcommand;
}

const data = new SlashCommandBuilder()
  .setName("reactforrole")
  .setDescription("Create or remove react-for-role messages")
  .addSubcommand(sub =>
    addOptionalPairOptions(
      addRequiredPairOption(
        sub
          .setName("create")
          .setDescription("Post a message with emoji reactions that grant roles")
          .addStringOption(option =>
            option
              .setName("message")
              .setDescription("Message content")
              .setRequired(true)
              .setMaxLength(2000)
          )
      )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel to post in (defaults to this channel)")
            .addChannelTypes(...TEXT_CHANNEL_TYPES)
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName("exclusive")
            .setDescription(
              "Only keep one role from this message at a time"
            )
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName("remove_on_unreact")
            .setDescription(
              "Remove the role when the user removes their reaction (default: yes)"
            )
            .setRequired(false)
        )
    )
  )
  .addSubcommand(sub =>
    sub
      .setName("remove")
      .setDescription("Stop tracking a react-for-role message")
      .addStringOption(option =>
        option
          .setName("message_id")
          .setDescription("Message ID or message link")
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    addAllOptionalPairOptions(
      sub
        .setName("edit")
        .setDescription("Edit an existing react-for-role message")
        .addStringOption(option =>
          option
            .setName("message_id")
            .setDescription("Message ID or message link")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription("New message content")
            .setRequired(false)
            .setMaxLength(2000)
        )
        .addBooleanOption(option =>
          option
            .setName("exclusive")
            .setDescription(
              "Only keep one role from this message at a time"
            )
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName("remove_on_unreact")
            .setDescription(
              "Remove the role when the user removes their reaction"
            )
            .setRequired(false)
        )
    )
  )
  .addSubcommand(sub =>
    addOptionalPairOptions(
      addRequiredPairOption(
        sub
          .setName("adopt")
          .setDescription("Attach react-role storage to an existing message")
          .addStringOption(option =>
            option
              .setName("message_id")
              .setDescription("Message ID or message link to adopt")
              .setRequired(true)
          )
      )
        .addBooleanOption(option =>
          option
            .setName("exclusive")
            .setDescription(
              "Only keep one role from this message at a time"
            )
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName("remove_on_unreact")
            .setDescription(
              "Remove the role when the user removes their reaction (default: yes)"
            )
            .setRequired(false)
        )
    )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

async function executeCreate(interaction) {
  const pairsResult = collectEmojiRolePairs(interaction);

  if (!pairsResult.ok) {
    return interaction.reply({
      content: `❌ ${pairsResult.error}`,
      ephemeral: true
    });
  }

  const targetChannel =
    interaction.options.getChannel("channel") || interaction.channel;
  const channelCheck = canPostInChannel(targetChannel);

  if (!channelCheck.ok) {
    return interaction.reply({
      content: `❌ ${channelCheck.error}`,
      ephemeral: true
    });
  }

  const guild = interaction.guild;
  const invalidRoles = pairsResult.pairs
    .map(({ role }) => role)
    .filter(role => !canBotManageRole(guild, role));

  if (invalidRoles.length) {
    return interaction.reply({
      content:
        "❌ I can't assign one or more of those roles. " +
        "They must be below my highest role and not managed by an integration.\n" +
        invalidRoles.map(role => `• ${role}`).join("\n"),
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const messageText = interaction.options.getString("message");
  const exclusive = interaction.options.getBoolean("exclusive") ?? false;
  const removeOnUnreact =
    interaction.options.getBoolean("remove_on_unreact") ?? true;

  let posted;

  try {
    posted = await targetChannel.send({ content: messageText });
  } catch (err) {
    console.error("[REACTFORROLE]", err);

    return interaction.editReply({
      content: "❌ Failed to post the message."
    });
  }

  const { mappings, summaryLines } = buildMappingsAndSummaryLines(
    pairsResult.pairs
  );

  try {
    await applyMessageReactions(posted, pairsResult.pairs);
  } catch (err) {
    console.error("[REACTFORROLE] react failed:", err);
    await posted.delete().catch(() => {});
    return interaction.editReply({
      content: "❌ Failed to add one or more reactions. Nothing was saved."
    });
  }

  await savePanel(guild.id, posted.id, {
    channelId: targetChannel.id,
    mappings,
    exclusive,
    removeOnUnreact,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString()
  });

  return interaction.editReply({
    content:
      `✅ React-for-role message created in <#${targetChannel.id}>.\n` +
      `${posted.url}\n\n` +
      summaryLines.join("\n") +
      (exclusive ? "\n\nExclusive: only one role from this message at a time." : "") +
      (removeOnUnreact
        ? ""
        : "\n\nRoles are kept when users remove their reaction.")
  });
}

async function executeRemove(interaction) {
  const messageId = parseMessageId(interaction.options.getString("message_id"));
  if (!messageId) {
    return interaction.reply({
      content: "❌ Provide a valid message ID or message link.",
      ephemeral: true
    });
  }

  const removed = await removePanel(interaction.guild.id, messageId);

  return interaction.reply({
    content: removed
      ? `✅ Stopped tracking react-for-role message \`${messageId}\`.`
      : `ℹ️ No react-for-role panel found for message \`${messageId}\`.`,
    ephemeral: true
  });
}

async function executeEdit(interaction) {
  const messageId = parseMessageId(interaction.options.getString("message_id"));
  if (!messageId) {
    return interaction.reply({
      content: "❌ Provide a valid message ID or message link.",
      ephemeral: true
    });
  }

  const existingPanel = await getPanel(interaction.guild.id, messageId);
  if (!existingPanel) {
    return interaction.reply({
      content: `❌ No react-for-role panel found for \`${messageId}\`.`,
      ephemeral: true
    });
  }

  const pairsResult = collectEmojiRolePairs(interaction, {
    requireAtLeastOne: false
  });
  if (!pairsResult.ok) {
    return interaction.reply({
      content: `❌ ${pairsResult.error}`,
      ephemeral: true
    });
  }

  const newMessageText = interaction.options.getString("message");
  const newExclusive = interaction.options.getBoolean("exclusive");
  const newRemoveOnUnreact = interaction.options.getBoolean("remove_on_unreact");
  const hasMappingUpdate = pairsResult.pairs.length > 0;
  const hasMessageUpdate = newMessageText !== null;
  const hasSettingsUpdate =
    newExclusive !== null || newRemoveOnUnreact !== null;

  if (!hasMappingUpdate && !hasMessageUpdate && !hasSettingsUpdate) {
    return interaction.reply({
      content: "❌ Provide at least one field to edit.",
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const channel = await interaction.guild.channels
    .fetch(existingPanel.channelId)
    .catch(() => null);
  if (!channel?.isTextBased?.()) {
    return interaction.editReply({
      content: "❌ Original channel not found for that panel."
    });
  }

  let targetMessage;
  try {
    targetMessage = await channel.messages.fetch(messageId);
  } catch {
    return interaction.editReply({
      content:
        "❌ Could not fetch that message. It may have been deleted or moved."
    });
  }

  if (hasMappingUpdate) {
    const invalidRoles = pairsResult.pairs
      .map(({ role }) => role)
      .filter(role => !canBotManageRole(interaction.guild, role));

    if (invalidRoles.length) {
      return interaction.editReply({
        content:
          "❌ I can't assign one or more of those roles.\n" +
          invalidRoles.map(role => `• ${role}`).join("\n")
      });
    }
  }

  if (hasMessageUpdate) {
    await targetMessage.edit({ content: newMessageText });
  }

  let mappings = existingPanel.mappings;
  let summaryLines = [];

  if (hasMappingUpdate) {
    const built = buildMappingsAndSummaryLines(pairsResult.pairs);
    mappings = built.mappings;
    summaryLines = built.summaryLines;

    try {
      await applyMessageReactions(targetMessage, pairsResult.pairs);
    } catch (err) {
      console.error("[REACTFORROLE] edit react failed:", err);
      return interaction.editReply({
        content: "❌ Failed updating reactions on that message."
      });
    }
  }

  const panel = {
    ...existingPanel,
    mappings,
    exclusive:
      newExclusive !== null ? newExclusive : existingPanel.exclusive,
    removeOnUnreact:
      newRemoveOnUnreact !== null
        ? newRemoveOnUnreact
        : existingPanel.removeOnUnreact,
    updatedBy: interaction.user.id,
    updatedAt: new Date().toISOString()
  };

  await savePanel(interaction.guild.id, messageId, panel);

  return interaction.editReply({
    content:
      `✅ Updated react-for-role message.\n${targetMessage.url}` +
      (summaryLines.length
        ? `\n\nNew mappings:\n${summaryLines.join("\n")}`
        : "")
  });
}

async function executeAdopt(interaction) {
  const messageId = parseMessageId(interaction.options.getString("message_id"));
  if (!messageId) {
    return interaction.reply({
      content: "❌ Provide a valid message ID or message link.",
      ephemeral: true
    });
  }

  const pairsResult = collectEmojiRolePairs(interaction);
  if (!pairsResult.ok) {
    return interaction.reply({
      content: `❌ ${pairsResult.error}`,
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const invalidRoles = pairsResult.pairs
    .map(({ role }) => role)
    .filter(role => !canBotManageRole(guild, role));
  if (invalidRoles.length) {
    return interaction.editReply({
      content:
        "❌ I can't assign one or more of those roles.\n" +
        invalidRoles.map(role => `• ${role}`).join("\n")
    });
  }

  let targetMessage = null;
  const channels = await guild.channels.fetch();
  for (const channel of channels.values()) {
    if (!channel?.isTextBased?.()) {
      continue;
    }

    targetMessage = await channel.messages.fetch(messageId).catch(() => null);
    if (targetMessage) {
      break;
    }
  }

  if (!targetMessage) {
    return interaction.editReply({
      content: "❌ Could not find that message in this server."
    });
  }

  try {
    await applyMessageReactions(targetMessage, pairsResult.pairs);
  } catch (err) {
    console.error("[REACTFORROLE] adopt react failed:", err);
    return interaction.editReply({
      content: "❌ Failed to apply reactions to that message."
    });
  }

  const { mappings, summaryLines } = buildMappingsAndSummaryLines(
    pairsResult.pairs
  );
  const exclusive = interaction.options.getBoolean("exclusive") ?? false;
  const removeOnUnreact =
    interaction.options.getBoolean("remove_on_unreact") ?? true;

  await savePanel(guild.id, messageId, {
    channelId: targetMessage.channelId,
    mappings,
    exclusive,
    removeOnUnreact,
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
    updatedBy: interaction.user.id,
    updatedAt: new Date().toISOString()
  });

  return interaction.editReply({
    content:
      `✅ Adopted existing message for react roles.\n${targetMessage.url}\n\n` +
      summaryLines.join("\n")
  });
}

module.exports = {
  data,
  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "create") {
      return executeCreate(interaction);
    }

    if (subcommand === "remove") {
      return executeRemove(interaction);
    }

    if (subcommand === "edit") {
      return executeEdit(interaction);
    }

    if (subcommand === "adopt") {
      return executeAdopt(interaction);
    }

    return interaction.reply({
      content: "❌ Unknown subcommand.",
      ephemeral: true
    });
  }
};
