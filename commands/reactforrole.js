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

function collectEmojiRolePairs(interaction) {
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

  if (!pairs.length) {
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

function addPairOptions(subcommand) {
  for (let index = 1; index <= MAX_PAIRS; index++) {
    subcommand
      .addStringOption(option =>
        option
          .setName(`emoji${index}`)
          .setDescription(
            index === 1
              ? "Emoji to react with (unicode or custom)"
              : `Optional emoji ${index}`
          )
          .setRequired(index === 1)
      )
      .addRoleOption(option =>
        option
          .setName(`role${index}`)
          .setDescription(
            index === 1
              ? "Role granted for emoji1"
              : `Optional role for emoji${index}`
          )
          .setRequired(index === 1)
      );
  }

  return subcommand;
}

const data = new SlashCommandBuilder()
  .setName("reactforrole")
  .setDescription("Create or remove react-for-role messages")
  .addSubcommand(sub =>
    addPairOptions(
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

  const mappings = {};
  const summaryLines = [];

  for (const { parsed, role } of pairsResult.pairs) {
    try {
      await posted.react(emojiReactArg(parsed));
      await delay(REACT_DELAY_MS);
    } catch (err) {
      console.error("[REACTFORROLE] react failed:", err);

      await posted.delete().catch(() => {});

      return interaction.editReply({
        content:
          `❌ Failed to add reaction ${formatEmojiLabel(parsed)}. ` +
          "Nothing was saved."
      });
    }

    const key = parsed.id || parsed.name;
    mappings[key] = role.id;
    summaryLines.push(`${formatEmojiLabel(parsed)} → ${role}`);
  }

  savePanel(guild.id, posted.id, {
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
  const raw = interaction.options.getString("message_id").trim();
  const idMatch = raw.match(/(\d{17,20})/);

  if (!idMatch) {
    return interaction.reply({
      content: "❌ Provide a valid message ID or message link.",
      ephemeral: true
    });
  }

  const messageId = idMatch[1];
  const removed = removePanel(interaction.guild.id, messageId);

  return interaction.reply({
    content: removed
      ? `✅ Stopped tracking react-for-role message \`${messageId}\`.`
      : `ℹ️ No react-for-role panel found for message \`${messageId}\`.`,
    ephemeral: true
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

    return interaction.reply({
      content: "❌ Unknown subcommand.",
      ephemeral: true
    });
  }
};
