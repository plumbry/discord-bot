const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const crypto = require("crypto");

const PREFIX = "reset_channels";
const PENDING_TTL_MS = 5 * 60 * 1000;
const DELETE_RETRY_DELAY_MS = 1000;
const DELETE_MAX_ATTEMPTS = 3;
const CHANNEL_RESET_DELAY_MS = 500;
const pendingResets = new Map();

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const TARGET_NAMES = new Set([
  "rules",
  "signups",
  "chat",
  "dropmap",
  "manualcode",
  "twitchlinks"
]);

const RESETTABLE_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum
]);

function normalizeChannelName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[\s\-_]+/g, "");
}

function matchesTarget(normalizedName, target) {
  switch (target) {
    case "rules":
      return normalizedName.includes("rules");

    case "signups":
      return normalizedName.includes("signup");

    case "chat":
      return (
        normalizedName.includes("chat") && !normalizedName.includes("modchat")
      );

    case "dropmap":
      return (
        normalizedName.includes("dropmap") ||
        (normalizedName.includes("drop") && normalizedName.includes("map"))
      );

    case "manualcode":
      return /manual\w*code/.test(normalizedName);

    case "twitchlinks":
      return (
        normalizedName.includes("twitch") &&
        (normalizedName.includes("stream") || normalizedName.includes("links"))
      );

    default:
      return false;
  }
}

function isTargetChannelName(name) {
  const normalized = normalizeChannelName(name);

  for (const target of TARGET_NAMES) {
    if (matchesTarget(normalized, target)) {
      return true;
    }
  }

  return false;
}

function canResetChannelType(channel) {
  return RESETTABLE_TYPES.has(channel.type);
}

function userCanRun(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels)
  );
}

function resolveGuildChannel(channel) {
  if (channel?.isThread?.()) {
    return channel.parent;
  }
  return channel;
}

function findChannelsToReset(guild, categoryId, commandChannelId) {
  const matches = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.parentId !== categoryId) {
      continue;
    }

    if (!canResetChannelType(channel)) {
      continue;
    }

    if (!isTargetChannelName(channel.name)) {
      continue;
    }

    if (channel.id === commandChannelId && !isTargetChannelName(channel.name)) {
      continue;
    }

    matches.push(channel);
  }

  return matches.sort((a, b) => b.position - a.position);
}

function buildCloneOptions(channel, reason) {
  const options = {
    name: channel.name,
    reason,
    parent: channel.parentId,
    nsfw: channel.nsfw,
    rateLimitPerUser: channel.rateLimitPerUser ?? 0,
    permissionOverwrites: channel.permissionOverwrites.cache.map(o => o.toJSON())
  };

  if (
    channel.type === ChannelType.GuildText ||
    channel.type === ChannelType.GuildAnnouncement ||
    channel.type === ChannelType.GuildForum
  ) {
    if (channel.topic != null) {
      options.topic = channel.topic;
    }
  }

  if (
    channel.type === ChannelType.GuildForum &&
    channel.defaultAutoArchiveDuration != null
  ) {
    options.defaultAutoArchiveDuration = channel.defaultAutoArchiveDuration;
  }

  return options;
}

async function deleteChannelWithRetry(guild, channelId, reason) {
  let lastError;

  for (let attempt = 1; attempt <= DELETE_MAX_ATTEMPTS; attempt++) {
    try {
      await guild.channels.delete(channelId, reason);
      return;
    } catch (err) {
      lastError = err;

      if (attempt < DELETE_MAX_ATTEMPTS) {
        await delay(DELETE_RETRY_DELAY_MS * attempt);
      }
    }
  }

  throw lastError;
}

async function resetChannel(guild, channel, reason) {
  const channelId = channel.id;
  const position = channel.rawPosition ?? channel.position;

  const cloned = await channel.clone(buildCloneOptions(channel, reason));

  try {
    await deleteChannelWithRetry(guild, channelId, reason);
    await cloned.setPosition(position);
  } catch (err) {
    await cloned.delete(reason).catch(() => {});
    throw err;
  }

  return cloned;
}

function prunePending() {
  const now = Date.now();

  for (const [token, job] of pendingResets.entries()) {
    if (now - job.createdAt > PENDING_TTL_MS) {
      pendingResets.delete(token);
    }
  }
}

function buildPreviewLines(channels) {
  return channels
    .map(channel => `• #${channel.name} (\`${channel.id}\`)`)
    .join("\n");
}

function buildResultSummary(results) {
  const lines = results.map(result => {
    if (result.ok) {
      return `✅ **#${result.name}** → <#${result.newId}>`;
    }

    return `❌ **#${result.name}** — ${result.error}`;
  });

  const succeeded = results.filter(r => r.ok).length;
  const failed = results.length - succeeded;

  return (
    `**Reset complete** (${succeeded} succeeded, ${failed} failed)\n\n` +
    lines.join("\n")
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("reset-channels")
    .setDescription(
      "Reset standard category channels by cloning them (clears all messages)"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const member = interaction.member;

    if (!userCanRun(member)) {
      return interaction.reply({
        content:
          "❌ You need **Administrator** or **Manage Channels** to use this command.",
        ephemeral: true
      });
    }

    const guild = interaction.guild;
    const botMember = guild.members.me;

    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: "❌ I need the **Manage Channels** permission to reset channels.",
        ephemeral: true
      });
    }

    const commandChannel = resolveGuildChannel(interaction.channel);

    if (!commandChannel) {
      return interaction.reply({
        content: "❌ Could not resolve the channel this command was used in.",
        ephemeral: true
      });
    }

    const categoryId = commandChannel.parentId;

    if (!categoryId) {
      return interaction.reply({
        content:
          "❌ This command must be used in a channel that belongs to a category.",
        ephemeral: true
      });
    }

    await guild.channels.fetch();

    const channels = findChannelsToReset(
      guild,
      categoryId,
      commandChannel.id
    );

    if (channels.length === 0) {
      return interaction.reply({
        content:
          "❌ No matching channels to reset in this category.\n\n" +
          "Targets: channels whose names contain rules, signup, chat, dropmap, manual+code, or twitch+stream/links",
        ephemeral: true
      });
    }

    prunePending();

    const token = crypto.randomUUID();
    pendingResets.set(token, {
      createdAt: Date.now(),
      userId: interaction.user.id,
      guildId: guild.id,
      categoryId,
      channelIds: channels.map(channel => channel.id)
    });

    const category = guild.channels.cache.get(categoryId);
    const categoryName = category?.name ?? "Unknown category";

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}_confirm:${token}`)
        .setLabel("Confirm Reset")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}_cancel:${token}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({
      content:
        `**Channel reset preview**\n` +
        `Category: **${categoryName}**\n` +
        `Channels to reset (${channels.length}):\n` +
        `${buildPreviewLines(channels)}\n\n` +
        "Each channel will be cloned with the same settings, then the original will be deleted. " +
        "This clears all messages, including those older than 14 days.\n\n" +
        "Click **Confirm Reset** to proceed.",
      components: [row],
      ephemeral: true
    });
  },

  async handleButton(interaction) {
    if (
      !interaction.customId.startsWith(`${PREFIX}_confirm:`) &&
      !interaction.customId.startsWith(`${PREFIX}_cancel:`)
    ) {
      return false;
    }

    const [action, token] = interaction.customId.split(":");

    prunePending();

    const job = pendingResets.get(token);

    if (!job) {
      await interaction.reply({
        content: "❌ This reset prompt has expired. Run `/reset-channels` again.",
        ephemeral: true
      });
      return true;
    }

    if (interaction.user.id !== job.userId) {
      await interaction.reply({
        content: "❌ Only the user who ran `/reset-channels` can confirm or cancel.",
        ephemeral: true
      });
      return true;
    }

    if (interaction.guildId !== job.guildId) {
      await interaction.reply({
        content: "❌ This reset prompt is for a different server.",
        ephemeral: true
      });
      return true;
    }

    pendingResets.delete(token);

    if (action === `${PREFIX}_cancel`) {
      await interaction.update({
        content: "❌ Channel reset cancelled.",
        components: []
      });
      return true;
    }

    if (!userCanRun(interaction.member)) {
      await interaction.update({
        content:
          "❌ You no longer have **Administrator** or **Manage Channels** permission.",
        components: []
      });
      return true;
    }

    const guild = interaction.guild;
    const botMember = guild.members.me;

    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.update({
        content: "❌ I no longer have the **Manage Channels** permission.",
        components: []
      });
      return true;
    }

    await interaction.update({
      content: "⏳ Resetting channels…",
      components: []
    });

    await guild.channels.fetch();

    const reason = `Channel reset by ${interaction.user.tag}`;
    const results = [];

    const channels = job.channelIds
      .map(id => guild.channels.cache.get(id))
      .filter(Boolean)
      .sort((a, b) => b.position - a.position);

    for (const channel of channels) {
      if (channel.parentId !== job.categoryId) {
        results.push({
          name: channel.name,
          ok: false,
          error: "Channel is no longer in the expected category"
        });
        continue;
      }

      if (!canResetChannelType(channel)) {
        results.push({
          name: channel.name,
          ok: false,
          error: "Channel type is not safe to reset"
        });
        continue;
      }

      if (!isTargetChannelName(channel.name)) {
        results.push({
          name: channel.name,
          ok: false,
          error: "Channel name no longer matches a reset target"
        });
        continue;
      }

      try {
        const cloned = await resetChannel(guild, channel, reason);
        results.push({
          name: channel.name,
          ok: true,
          newId: cloned.id
        });
      } catch (err) {
        console.error(
          `[RESET-CHANNELS] failed #${channel.name}:`,
          err?.message || err
        );
        results.push({
          name: channel.name,
          ok: false,
          error: err?.message || "Unknown error"
        });
      }

      await delay(CHANNEL_RESET_DELAY_MS);
    }

    await interaction.editReply({
      content: buildResultSummary(results),
      components: []
    });

    return true;
  }
};
