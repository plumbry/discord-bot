const fs = require("fs");
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
  ChannelType
} = require("discord.js");

const { listPresets } = require("../lib/rulesSheet");
const { listSuggestions, TYPES } = require("../lib/rulesSuggestionsSheet");
const { getEventBanRows, normalizeRows } = require("../lib/eventBanSheet");
const { STATE_PATH } = require("../lib/rulesStore");
const { listScrimEventsForGuild } = require("../lib/scrimEventSheet");
const { listPostsForGuild } = require("../lib/rulesPostsSheet");

const pkg = require("../package.json");

const MAX_FILE_BYTES = 8 * 1024 * 1024;

const CHANNEL_TYPE_NAMES = Object.fromEntries(
  Object.entries(ChannelType).map(([name, value]) => [value, name])
);

// Run a section collector and capture failures inline rather than aborting the
// whole export when a single source (e.g. a sheet) is unavailable.
async function safeSection(collect) {
  try {
    return await collect();
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

function serializeOverwrites(channel) {
  return [...channel.permissionOverwrites.cache.values()].map(overwrite => ({
    id: overwrite.id,
    type: overwrite.type === 0 ? "role" : "member",
    allow: overwrite.allow.bitfield.toString(),
    deny: overwrite.deny.bitfield.toString()
  }));
}

function serializeChannel(channel) {
  return {
    id: channel.id,
    name: channel.name,
    type: CHANNEL_TYPE_NAMES[channel.type] || channel.type,
    parentId: channel.parentId || null,
    position: channel.rawPosition ?? channel.position ?? null,
    topic: channel.topic ?? null,
    nsfw: typeof channel.nsfw === "boolean" ? channel.nsfw : null,
    rateLimitPerUser: channel.rateLimitPerUser ?? null,
    bitrate: channel.bitrate ?? null,
    userLimit: channel.userLimit ?? null,
    permissionOverwrites: serializeOverwrites(channel)
  };
}

function collectServerSettings(guild) {
  return {
    id: guild.id,
    name: guild.name,
    description: guild.description ?? null,
    verificationLevel: guild.verificationLevel,
    explicitContentFilter: guild.explicitContentFilter,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    mfaLevel: guild.mfaLevel,
    afkChannelId: guild.afkChannelId,
    afkTimeout: guild.afkTimeout,
    systemChannelId: guild.systemChannelId,
    systemChannelFlags: guild.systemChannelFlags?.toArray?.() || [],
    rulesChannelId: guild.rulesChannelId,
    publicUpdatesChannelId: guild.publicUpdatesChannelId,
    preferredLocale: guild.preferredLocale,
    premiumTier: guild.premiumTier,
    premiumSubscriptionCount: guild.premiumSubscriptionCount,
    vanityURLCode: guild.vanityURLCode ?? null,
    features: guild.features || [],
    ownerId: guild.ownerId,
    iconURL: guild.iconURL({ size: 256 }) || null,
    bannerURL: guild.bannerURL({ size: 512 }) || null,
    splashURL: guild.splashURL({ size: 512 }) || null
  };
}

async function collectBotConfig(guild) {
  const guildId = guild.id;
  const config = {};

  config.rulesPresets = await safeSection(() => listPresets(guildId));

  config.rulesSuggestions = await safeSection(async () => ({
    bans: await listSuggestions(guildId, TYPES.BAN),
    rules: await listSuggestions(guildId, TYPES.RULE)
  }));

  config.eventBans = await safeSection(async () => {
    const rows = await getEventBanRows();
    return normalizeRows(rows);
  });

  config.localRulesState = await safeSection(() => {
    if (!fs.existsSync(STATE_PATH)) {
      return {};
    }

    const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return state?.eventsByGuild?.[guildId] || {};
  });

  config.scrimEvents = await safeSection(() => listScrimEventsForGuild(guildId));

  config.rulesPosts = await safeSection(() => listPostsForGuild(guildId));

  return config;
}

function countSection(section) {
  if (!section) return 0;
  if (Array.isArray(section)) return section.length;
  if (section.error) return 0;
  return Object.keys(section).length;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("serverexport")
    .setDescription(
      "Export all server settings (Discord config + bot config) to a JSON file"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true
      });
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    let channels = [];

    try {
      const channelCollection = await guild.channels.fetch();
      channels = [...channelCollection.values()]
        .filter(Boolean)
        .map(serializeChannel)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    } catch (err) {
      console.error("[SERVEREXPORT] channel fetch failed:", err?.message || err);
    }

    const botConfig = await collectBotConfig(guild);

    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        guild: { id: guild.id, name: guild.name },
        botVersion: pkg.version
      },
      serverSettings: collectServerSettings(guild),
      channels,
      botConfig
    };

    const body = JSON.stringify(payload, null, 2);
    const buffer = Buffer.from(body, "utf8");

    if (buffer.byteLength > MAX_FILE_BYTES) {
      return interaction.editReply(
        `Export is too large to upload (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB).`
      );
    }

    const safeGuildName =
      guild.name.replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "") ||
      "guild";

    const fileName = `server-settings-${safeGuildName}-${
      new Date().toISOString().slice(0, 10)
    }.json`;

    const file = new AttachmentBuilder(buffer, { name: fileName });

    const summary =
      `Exported server settings for **${guild.name}**:\n` +
      `- ${channels.length} channel(s)/categor(ies)\n` +
      `- ${countSection(botConfig.rulesPresets)} rules preset(s)\n` +
      `- ${countSection(botConfig.eventBans)} event ban row(s)\n` +
      `- ${countSection(botConfig.scrimEvents)} scrim event(s)\n` +
      `- ${countSection(botConfig.rulesPosts)} rules post(s)\n` +
      "Roles and emojis are excluded (use `/rolesexport` and `/emojiexport`).";

    await interaction.editReply({
      content: summary,
      files: [file]
    });
  }
};
