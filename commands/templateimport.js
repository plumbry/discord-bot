const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require("discord.js");
const axios = require("axios");

const CREATE_DELAY_MS = 700;

const delay = ms => new Promise(r => setTimeout(r, ms));

function describeError(err) {
  return err?.rawError?.message || err?.message || "unknown error";
}

function pick(obj, ...keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return undefined;
}

// Map a Discord channel type (int or string) to a discord.js ChannelType.
function parseChannelType(value) {
  if (typeof value === "number") return value;
  if (value === undefined || value === null) return ChannelType.GuildText;

  const key = String(value).trim().toUpperCase().replace(/[\s-]+/g, "_");
  const map = {
    GUILD_TEXT: ChannelType.GuildText,
    TEXT: ChannelType.GuildText,
    GUILD_VOICE: ChannelType.GuildVoice,
    VOICE: ChannelType.GuildVoice,
    GUILD_CATEGORY: ChannelType.GuildCategory,
    CATEGORY: ChannelType.GuildCategory,
    GUILD_ANNOUNCEMENT: ChannelType.GuildAnnouncement,
    ANNOUNCEMENT: ChannelType.GuildAnnouncement,
    NEWS: ChannelType.GuildAnnouncement,
    GUILD_STAGE_VOICE: ChannelType.GuildStageVoice,
    STAGE: ChannelType.GuildStageVoice,
    GUILD_FORUM: ChannelType.GuildForum,
    FORUM: ChannelType.GuildForum,
    GUILD_MEDIA: ChannelType.GuildMedia,
    MEDIA: ChannelType.GuildMedia
  };

  return map[key] ?? ChannelType.GuildText;
}

function toBigIntSafe(value) {
  try {
    if (value === undefined || value === null || value === "") return 0n;
    return BigInt(value);
  } catch {
    return 0n;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("templateimport")
    .setDescription(
      "Recreate categories and channels (with hierarchy) from a template JSON file"
    )
    .addAttachmentOption(o =>
      o
        .setName("file")
        .setDescription("The template JSON file")
        .setRequired(true)
    )
    .addBooleanOption(o =>
      o
        .setName("skip_existing")
        .setDescription(
          "Skip channels whose name already exists here (default: true)"
        )
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

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
    const skipExisting = interaction.options.getBoolean("skip_existing") ?? true;

    let manifest;

    try {
      const res = await axios.get(attachment.url, { responseType: "text" });
      manifest =
        typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    } catch (err) {
      console.error("[TEMPLATEIMPORT] manifest load failed:", err?.message || err);
      return interaction.editReply(
        "Could not read or parse the attached file. Make sure it is the template JSON file."
      );
    }

    if (!manifest || typeof manifest !== "object") {
      return interaction.editReply("That file is empty or not a JSON object.");
    }

    // Native Discord templates nest everything under serialized_source_guild.
    const root = manifest.serialized_source_guild || manifest;

    let channels =
      pick(root, "channels") || pick(manifest, "channels") || [];

    // Some exports split categories out separately; merge them in.
    const separateCategories =
      pick(root, "categories") || pick(manifest, "categories");
    if (Array.isArray(separateCategories)) {
      channels = [...separateCategories, ...channels];
    }

    if (!Array.isArray(channels) || channels.length === 0) {
      const keys = Object.keys(root).slice(0, 25).join(", ") || "(none)";
      return interaction.editReply(
        "No channels were found in that file.\n" +
          `Top-level keys seen: \`${keys}\`\n` +
          "If your file stores channels under a different key, send me a sample and I'll map it."
      );
    }

    // Normalise each entry into a common shape.
    const items = channels.map((c, index) => ({
      sourceId: pick(c, "id") !== undefined ? String(pick(c, "id")) : null,
      name: pick(c, "name") || "",
      type: parseChannelType(pick(c, "type")),
      parentId:
        pick(c, "parent_id", "parentId", "parent", "category_id", "categoryId") !==
        undefined
          ? String(
              pick(c, "parent_id", "parentId", "parent", "category_id", "categoryId")
            )
          : null,
      position: Number.isFinite(Number(pick(c, "position")))
        ? Number(pick(c, "position"))
        : index,
      topic: pick(c, "topic"),
      nsfw: pick(c, "nsfw"),
      rateLimitPerUser: pick(c, "rate_limit_per_user", "rateLimitPerUser"),
      bitrate: pick(c, "bitrate"),
      userLimit: pick(c, "user_limit", "userLimit"),
      overwrites: pick(c, "permission_overwrites", "permissionOverwrites")
    }));

    // Build permission overwrites for the TARGET guild, matched by role NAME
    // (source role/member IDs from the export don't exist in the new server).
    const buildOverwrites = item => {
      if (!Array.isArray(item.overwrites)) return { overwrites: [], skipped: 0 };

      const out = [];
      let skipped = 0;

      for (const ow of item.overwrites) {
        const targetType = String(
          pick(ow, "targetType", "type") ?? "role"
        ).toLowerCase();

        // Member overwrites reference specific users who usually aren't in
        // the new server, so they can't be carried over.
        if (targetType === "member" || targetType === "1") {
          skipped++;
          continue;
        }

        const roleName = pick(ow, "roleName", "name");
        let targetRoleId = null;

        if (roleName && String(roleName) === "@everyone") {
          targetRoleId = guild.roles.everyone.id;
        } else if (roleName) {
          const match = guild.roles.cache.find(
            r => r.name.toLowerCase() === String(roleName).toLowerCase()
          );
          if (match) targetRoleId = match.id;
        }

        if (!targetRoleId) {
          skipped++;
          continue;
        }

        out.push({
          id: targetRoleId,
          allow: toBigIntSafe(pick(ow, "allow")),
          deny: toBigIntSafe(pick(ow, "deny"))
        });
      }

      return { overwrites: out, skipped };
    };

    // Existing channels keyed by "type:name" so re-runs don't duplicate.
    let existingKeys = new Set();
    try {
      const current = await guild.channels.fetch();
      for (const channel of current.values()) {
        if (channel) {
          existingKeys.add(`${channel.type}:${channel.name.toLowerCase()}`);
        }
      }
    } catch (err) {
      console.error("[TEMPLATEIMPORT] channel fetch failed:", err?.message || err);
    }

    const categories = items
      .filter(i => i.type === ChannelType.GuildCategory && i.name)
      .sort((a, b) => a.position - b.position);

    const nonCategories = items
      .filter(i => i.type !== ChannelType.GuildCategory && i.name)
      .sort((a, b) => a.position - b.position);

    await interaction.editReply(
      `Importing **${categories.length}** categor(y/ies) and **${nonCategories.length}** channel(s) into **${guild.name}**. This can take a while...`
    );

    const createdCategoriesById = new Map();
    const createdCategoriesByName = new Map();

    let categoriesCreated = 0;
    let channelsCreated = 0;
    let overwritesApplied = 0;
    let overwritesSkipped = 0;
    const skippedExisting = [];
    const failed = [];

    // ---- Pass 1: categories (parents first for hierarchy) ----
    for (const cat of categories) {
      if (skipExisting && existingKeys.has(`${ChannelType.GuildCategory}:${cat.name.toLowerCase()}`)) {
        skippedExisting.push(cat.name);
        const existing = guild.channels.cache.find(
          c =>
            c.type === ChannelType.GuildCategory &&
            c.name.toLowerCase() === cat.name.toLowerCase()
        );
        if (existing) {
          if (cat.sourceId) createdCategoriesById.set(cat.sourceId, existing);
          createdCategoriesByName.set(cat.name.toLowerCase(), existing);
        }
        continue;
      }

      const { overwrites, skipped } = buildOverwrites(cat);
      overwritesSkipped += skipped;

      try {
        const created = await guild.channels.create({
          name: cat.name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: overwrites,
          reason: "templateimport: recreate category from template"
        });

        overwritesApplied += overwrites.length;
        categoriesCreated++;

        if (cat.sourceId) createdCategoriesById.set(cat.sourceId, created);
        createdCategoriesByName.set(cat.name.toLowerCase(), created);
        existingKeys.add(`${ChannelType.GuildCategory}:${cat.name.toLowerCase()}`);
      } catch (err) {
        failed.push({ name: cat.name, reason: describeError(err) });
        console.error(
          `[TEMPLATEIMPORT] failed to create category ${cat.name}:`,
          err?.message || err
        );
      }

      await delay(CREATE_DELAY_MS);
    }

    // ---- Pass 2: channels under their categories ----
    for (const ch of nonCategories) {
      if (skipExisting && existingKeys.has(`${ch.type}:${ch.name.toLowerCase()}`)) {
        skippedExisting.push(ch.name);
        continue;
      }

      // Resolve parent category by source id, then by name fallback.
      let parent = null;
      if (ch.parentId) {
        parent =
          createdCategoriesById.get(ch.parentId) ||
          createdCategoriesByName.get(ch.parentId.toLowerCase()) ||
          null;
      }

      const { overwrites, skipped } = buildOverwrites(ch);
      overwritesSkipped += skipped;

      const options = {
        name: ch.name,
        type: ch.type,
        permissionOverwrites: overwrites,
        reason: "templateimport: recreate channel from template"
      };

      if (parent) options.parent = parent.id;
      if (typeof ch.topic === "string" && ch.topic) options.topic = ch.topic;
      if (typeof ch.nsfw === "boolean") options.nsfw = ch.nsfw;
      if (typeof ch.rateLimitPerUser === "number") {
        options.rateLimitPerUser = ch.rateLimitPerUser;
      }
      if (typeof ch.bitrate === "number") options.bitrate = ch.bitrate;
      if (typeof ch.userLimit === "number") options.userLimit = ch.userLimit;

      try {
        await guild.channels.create(options);
        overwritesApplied += overwrites.length;
        channelsCreated++;
        existingKeys.add(`${ch.type}:${ch.name.toLowerCase()}`);
      } catch (err) {
        failed.push({ name: ch.name, reason: describeError(err) });
        console.error(
          `[TEMPLATEIMPORT] failed to create channel ${ch.name}:`,
          err?.message || err
        );
      }

      await delay(CREATE_DELAY_MS);
    }

    const lines = [
      `Template import finished for **${guild.name}**:`,
      `- Categories created: **${categoriesCreated}**`,
      `- Channels created: **${channelsCreated}**`,
      `- Skipped (already exist): **${skippedExisting.length}**`,
      `- Failed: **${failed.length}**`,
      `- Permission overwrites applied: **${overwritesApplied}** (skipped: **${overwritesSkipped}**)`
    ];

    if (failed.length > 0) {
      const sample = failed
        .slice(0, 10)
        .map(f => `\`${f.name}\` (${f.reason})`)
        .join(", ");
      lines.push(`\nFailures: ${sample}${failed.length > 10 ? ", ..." : ""}`);
      lines.push(
        "\nNote: the bot needs **Manage Channels**, and can only set permissions it holds. Overwrites are matched to this server's roles by name, so import roles first (e.g. `/rolesimport`)."
      );
    }

    await interaction.editReply(lines.join("\n"));
  }
};
