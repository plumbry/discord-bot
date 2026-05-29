const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  GuildVerificationLevel,
  GuildDefaultMessageNotifications,
  GuildExplicitContentFilter,
  GuildSystemChannelFlags
} = require("discord.js");
const axios = require("axios");

function describeError(err) {
  return err?.rawError?.message || err?.message || "unknown error";
}

// Read the first defined value from a list of possible key aliases.
function pick(obj, ...keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return undefined;
}

function normaliseKey(value) {
  return String(value).trim().toUpperCase().replace(/[\s-]+/g, "_");
}

// Map a Discord int or human/enum string to a verification level (0-4).
function parseVerification(value) {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const map = {
    NONE: GuildVerificationLevel.None,
    LOW: GuildVerificationLevel.Low,
    MEDIUM: GuildVerificationLevel.Medium,
    HIGH: GuildVerificationLevel.High,
    VERY_HIGH: GuildVerificationLevel.VeryHigh,
    HIGHEST: GuildVerificationLevel.VeryHigh
  };
  return map[normaliseKey(value)];
}

function parseNotifications(value) {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const map = {
    ALL_MESSAGES: GuildDefaultMessageNotifications.AllMessages,
    ALL: GuildDefaultMessageNotifications.AllMessages,
    ONLY_MENTIONS: GuildDefaultMessageNotifications.OnlyMentions,
    MENTIONS: GuildDefaultMessageNotifications.OnlyMentions
  };
  return map[normaliseKey(value)];
}

function parseContentFilter(value) {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const map = {
    DISABLED: GuildExplicitContentFilter.Disabled,
    MEMBERS_WITHOUT_ROLES: GuildExplicitContentFilter.MembersWithoutRoles,
    ALL_MEMBERS: GuildExplicitContentFilter.AllMembers
  };
  return map[normaliseKey(value)];
}

// system_channel_flags can be a raw int bitfield or an array of flag names.
function parseSystemChannelFlags(value) {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) {
    let bits = 0;
    for (const name of value) {
      const flag = GuildSystemChannelFlags[normaliseKey(name)
        .split("_")
        .map((p, i) =>
          i === 0
            ? p.charAt(0) + p.slice(1).toLowerCase()
            : p.charAt(0) + p.slice(1).toLowerCase()
        )
        .join("")];
      // Fall back to direct lookup by the provided name.
      const direct = GuildSystemChannelFlags[name];
      if (typeof flag === "number") bits |= flag;
      else if (typeof direct === "number") bits |= direct;
    }
    return bits;
  }
  return undefined;
}

// Resolve a channel by name in the target guild (source IDs won't carry over).
function resolveChannelByName(guild, value) {
  if (value === undefined) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;

  // If it happens to be a real ID in this guild, use it.
  const byId = guild.channels.cache.get(raw);
  if (byId) return byId;

  const lower = raw.toLowerCase();
  return (
    guild.channels.cache.find(c => c.name?.toLowerCase() === lower) || null
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("serversettingsimport")
    .setDescription(
      "Apply server settings (not name/description/icon/banner) from a server-settings JSON file"
    )
    .addAttachmentOption(o =>
      o
        .setName("file")
        .setDescription("The server-settings JSON file")
        .setRequired(true)
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

    const attachment = interaction.options.getAttachment("file");

    let manifest;

    try {
      const res = await axios.get(attachment.url, { responseType: "text" });
      manifest =
        typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    } catch (err) {
      console.error(
        "[SERVERSETTINGSIMPORT] manifest load failed:",
        err?.message || err
      );
      return interaction.editReply(
        "Could not read or parse the attached file. Make sure it is the server-settings JSON file."
      );
    }

    if (!manifest || typeof manifest !== "object") {
      return interaction.editReply(
        "That file is empty or not a JSON object."
      );
    }

    // Settings may sit at the root or under a wrapper key.
    const root =
      pick(manifest, "settings", "serverSettings", "server_settings", "guild") ||
      manifest.serialized_source_guild ||
      manifest;

    // Per request: name, description, icon and banner are intentionally NOT imported.
    const editOptions = {};
    const applied = [];
    const skipped = [];

    const verification = parseVerification(
      pick(root, "verification_level", "verificationLevel")
    );
    if (verification !== undefined) {
      editOptions.verificationLevel = verification;
      applied.push("verification level");
    }

    const notifications = parseNotifications(
      pick(root, "default_message_notifications", "defaultMessageNotifications")
    );
    if (notifications !== undefined) {
      editOptions.defaultMessageNotifications = notifications;
      applied.push("default notifications");
    }

    const contentFilter = parseContentFilter(
      pick(root, "explicit_content_filter", "explicitContentFilter")
    );
    if (contentFilter !== undefined) {
      editOptions.explicitContentFilter = contentFilter;
      applied.push("explicit content filter");
    }

    const afkTimeout = pick(root, "afk_timeout", "afkTimeout");
    if (typeof afkTimeout === "number") {
      editOptions.afkTimeout = afkTimeout;
      applied.push("AFK timeout");
    }

    const preferredLocale = pick(root, "preferred_locale", "preferredLocale");
    if (typeof preferredLocale === "string" && preferredLocale.trim()) {
      editOptions.preferredLocale = preferredLocale.trim();
      applied.push("preferred locale");
    }

    const progressBar = pick(
      root,
      "premium_progress_bar_enabled",
      "premiumProgressBarEnabled"
    );
    if (typeof progressBar === "boolean") {
      editOptions.premiumProgressBarEnabled = progressBar;
      applied.push("boost progress bar");
    }

    const systemFlags = parseSystemChannelFlags(
      pick(root, "system_channel_flags", "systemChannelFlags")
    );
    if (systemFlags !== undefined) {
      editOptions.systemChannelFlags = systemFlags;
      applied.push("system channel flags");
    }

    // Channel references resolve by NAME in this server (source IDs differ).
    const afkChannel = resolveChannelByName(
      guild,
      pick(root, "afk_channel", "afkChannel", "afk_channel_name")
    );
    if (afkChannel) {
      editOptions.afkChannel = afkChannel;
      applied.push(`AFK channel (#${afkChannel.name})`);
    } else if (
      pick(root, "afk_channel", "afkChannel", "afk_channel_name") !== undefined
    ) {
      skipped.push("AFK channel (no matching channel name here)");
    }

    const systemChannel = resolveChannelByName(
      guild,
      pick(root, "system_channel", "systemChannel", "system_channel_name")
    );
    if (systemChannel) {
      editOptions.systemChannel = systemChannel;
      applied.push(`system channel (#${systemChannel.name})`);
    } else if (
      pick(root, "system_channel", "systemChannel", "system_channel_name") !==
      undefined
    ) {
      skipped.push("system channel (no matching channel name here)");
    }

    if (Object.keys(editOptions).length === 0) {
      const keys = Object.keys(root).slice(0, 25).join(", ") || "(none)";
      return interaction.editReply(
        "No recognised settings were found in that file, so nothing was changed.\n" +
          `Top-level keys seen: \`${keys}\`\n` +
          "If your file uses different field names, send me a sample and I'll map them."
      );
    }

    try {
      await guild.edit({
        ...editOptions,
        reason: "serversettingsimport: apply settings from export"
      });
    } catch (err) {
      console.error(
        "[SERVERSETTINGSIMPORT] guild.edit failed:",
        err?.message || err
      );
      return interaction.editReply(
        `Failed to apply settings to **${guild.name}**: ${describeError(err)}\n` +
          "The bot needs the **Manage Server** permission, and some settings may require server features it lacks."
      );
    }

    const lines = [
      `Server settings applied to **${guild.name}**:`,
      `- Applied: **${applied.length}** — ${applied.join(", ")}`
    ];

    if (skipped.length > 0) {
      lines.push(`- Skipped: **${skipped.length}** — ${skipped.join(", ")}`);
    }

    lines.push(
      "\nNote: server name, description, icon and banner were intentionally left unchanged."
    );

    await interaction.editReply(lines.join("\n"));
  }
};
