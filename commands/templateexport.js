const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
  ChannelType
} = require("discord.js");

const MAX_FILE_BYTES = 8 * 1024 * 1024;

// Discord channel type enum -> stable string label, so the export stays
// readable and is not tied to discord.js numeric internals.
const CHANNEL_TYPE_NAMES = {
  [ChannelType.GuildText]: "text",
  [ChannelType.GuildVoice]: "voice",
  [ChannelType.GuildCategory]: "category",
  [ChannelType.GuildAnnouncement]: "announcement",
  [ChannelType.GuildStageVoice]: "stage",
  [ChannelType.GuildForum]: "forum",
  [ChannelType.GuildMedia]: "media"
};

function channelTypeName(type) {
  return CHANNEL_TYPE_NAMES[type] ?? `unknown_${type}`;
}

function serializeSettings(guild) {
  const afkChannel = guild.afkChannelId
    ? guild.channels.cache.get(guild.afkChannelId)
    : null;
  const systemChannel = guild.systemChannelId
    ? guild.channels.cache.get(guild.systemChannelId)
    : null;

  return {
    name: guild.name,
    description: guild.description || null,
    verificationLevel: guild.verificationLevel,
    defaultMessageNotifications: guild.defaultMessageNotifications,
    explicitContentFilter: guild.explicitContentFilter,
    afkTimeout: guild.afkTimeout,
    afkChannel: afkChannel ? afkChannel.name : null,
    systemChannel: systemChannel ? systemChannel.name : null,
    systemChannelFlags: guild.systemChannelFlags?.bitfield
      ? guild.systemChannelFlags.bitfield.toString()
      : "0",
    preferredLocale: guild.preferredLocale,
    premiumProgressBarEnabled: Boolean(guild.premiumProgressBarEnabled)
  };
}

function serializeRoles(guild) {
  return [...guild.roles.cache.values()]
    .filter(role => !role.managed)
    .sort((a, b) => b.position - a.position)
    .map(role => ({
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: role.mentionable,
      position: role.position,
      isEveryone: role.id === guild.id,
      permissions: role.permissions.bitfield.toString()
    }));
}

function serializeOverwrites(channel, guild) {
  return [...channel.permissionOverwrites.cache.values()].map(overwrite => {
    const isRole = overwrite.type === 0;
    const role = isRole ? guild.roles.cache.get(overwrite.id) : null;

    return {
      targetType: isRole ? "role" : "member",
      id: overwrite.id,
      roleName: role ? role.name : null,
      allow: overwrite.allow.bitfield.toString(),
      deny: overwrite.deny.bitfield.toString()
    };
  });
}

function serializeChannel(channel, guild) {
  const parent = channel.parentId
    ? guild.channels.cache.get(channel.parentId)
    : null;

  return {
    name: channel.name,
    type: channelTypeName(channel.type),
    position: channel.rawPosition ?? channel.position ?? 0,
    parent: parent ? parent.name : null,
    topic: channel.topic ?? null,
    nsfw: typeof channel.nsfw === "boolean" ? channel.nsfw : false,
    rateLimitPerUser: channel.rateLimitPerUser ?? null,
    bitrate: channel.bitrate ?? null,
    userLimit: channel.userLimit ?? null,
    permissionOverwrites: serializeOverwrites(channel, guild)
  };
}

function serializeChannels(guild) {
  const all = [...guild.channels.cache.values()];

  const categories = all
    .filter(c => c.type === ChannelType.GuildCategory)
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));

  const others = all
    .filter(c => c.type !== ChannelType.GuildCategory)
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));

  // Categories first, then their children grouped underneath, then any
  // channels without a parent category.
  const ordered = [];

  for (const category of categories) {
    ordered.push(serializeChannel(category, guild));
    for (const child of others.filter(c => c.parentId === category.id)) {
      ordered.push(serializeChannel(child, guild));
    }
  }

  for (const orphan of others.filter(c => !c.parentId)) {
    ordered.push(serializeChannel(orphan, guild));
  }

  return ordered;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("templateexport")
    .setDescription(
      "Export this server's structure (roles, channels, settings) to a JSON template file"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

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

    try {
      // Ensure the cache is fully populated before we serialize.
      await guild.roles.fetch();
      await guild.channels.fetch();
    } catch (err) {
      console.error("[TEMPLATEEXPORT] fetch failed:", err?.message || err);
      return interaction.editReply(
        "Could not load the server's roles and channels. Try again later."
      );
    }

    const settings = serializeSettings(guild);
    const roles = serializeRoles(guild);
    const channels = serializeChannels(guild);

    const payload = {
      guild: { id: guild.id, name: guild.name },
      exportedAt: new Date().toISOString(),
      version: 1,
      settings,
      roles,
      channels
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

    const fileName = `template-${safeGuildName}-${
      new Date().toISOString().slice(0, 10)
    }.json`;

    const file = new AttachmentBuilder(buffer, { name: fileName });

    const categoryCount = channels.filter(c => c.type === "category").length;
    const channelCount = channels.length - categoryCount;

    await interaction.editReply({
      content:
        `Exported **${roles.length}** role(s) and ` +
        `**${channelCount}** channel(s) across **${categoryCount}** categor${
          categoryCount === 1 ? "y" : "ies"
        }.\n` +
        "This file captures the server structure only — no template was created in Discord settings.",
      files: [file]
    });
  }
};
