const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  GatewayIntentBits
} = require("discord.js");

const ONLINE_STATUSES = new Set(["online", "idle", "dnd"]);
const EMBED_DESCRIPTION_LIMIT = 4096;
const EMBED_COLOR = 0x57f287;
const NO_PING_MENTIONS = { parse: [] };

function getDisplayName(member) {
  return (
    member.displayName ||
    member.user?.globalName ||
    member.user?.username ||
    member.id
  );
}

function isConsideredOnline(member) {
  return ONLINE_STATUSES.has(member.presence?.status);
}

function compareDisplayNames(a, b) {
  return getDisplayName(a).localeCompare(getDisplayName(b), undefined, {
    sensitivity: "base"
  });
}

function buildFilterHeader(role1, role2, excludeRole) {
  const required = role2 ? `${role1.name} + ${role2.name}` : role1.name;
  const lines = [`**Required:** ${required}`];

  if (excludeRole) {
    lines.push(`**Excluded:** ${excludeRole.name}`);
  }

  return lines.join("\n");
}

function buildEmptyMessage(role1, role2, excludeRole) {
  if (role2 && excludeRole) {
    return `No online members currently have both **${role1.name}** and **${role2.name}** without **${excludeRole.name}**.`;
  }

  if (role2) {
    return `No online members currently have both **${role1.name}** and **${role2.name}**.`;
  }

  if (excludeRole) {
    return `No online members currently have **${role1.name}** without **${excludeRole.name}**.`;
  }

  return `No online members currently have **${role1.name}**.`;
}

function chunkDescriptionPages(header, lines) {
  const prefix = `${header}\n\n`;
  const budget = EMBED_DESCRIPTION_LIMIT - prefix.length;
  const pages = [];
  let current = [];
  let currentLength = 0;

  for (const line of lines) {
    const extra = current.length === 0 ? line.length : line.length + 1;

    if (current.length > 0 && currentLength + extra > budget) {
      pages.push(prefix + current.join("\n"));
      current = [];
      currentLength = 0;
    }

    current.push(line);
    currentLength += current.length === 1 ? line.length : line.length + 1;
  }

  if (current.length > 0) {
    pages.push(prefix + current.join("\n"));
  }

  return pages;
}

function buildEmptyEmbed(role1, role2, excludeRole, warning) {
  const embed = new EmbedBuilder()
    .setTitle("🟢 Online Members")
    .setColor(EMBED_COLOR)
    .setDescription(
      `${buildFilterHeader(role1, role2, excludeRole)}\n\n${buildEmptyMessage(
        role1,
        role2,
        excludeRole
      )}`
    );

  if (warning) {
    embed.setFooter({ text: warning });
  }

  return embed;
}

function buildResultEmbeds(role1, role2, excludeRole, members, warning) {
  const header = buildFilterHeader(role1, role2, excludeRole);
  const lines = members.map(member => `* <@${member.id}>`);
  const pages = chunkDescriptionPages(header, lines);
  const pageCount = pages.length;
  const countLabel = `${members.length} member${
    members.length === 1 ? "" : "s"
  } online`;

  return pages.map((description, index) => {
    const embed = new EmbedBuilder()
      .setTitle(index === 0 ? "🟢 Online Members" : "🟢 Online Members (continued)")
      .setColor(EMBED_COLOR)
      .setDescription(description);

    const footerParts = [countLabel];

    if (pageCount > 1) {
      footerParts.push(`page ${index + 1} of ${pageCount}`);
    }

    if (warning && index === 0) {
      footerParts.push(warning);
    }

    embed.setFooter({ text: footerParts.join(" · ") });
    return embed;
  });
}

function presenceIntentEnabled(guild) {
  return guild.client.options.intents.has(GatewayIntentBits.GuildPresences);
}

async function fetchMembersWithPresence(guild) {
  try {
    const members = await guild.members.fetch({ withPresences: true });
    return { members, withPresences: true };
  } catch (err) {
    console.error("[ONLINE] fetch with presences failed:", err?.message || err);
    const members = await guild.members.fetch();
    return { members, withPresences: false };
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("online")
    .setDescription(
      "List currently online members who have the selected role(s)"
    )
    .addRoleOption(option =>
      option
        .setName("role1")
        .setDescription("Required role")
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName("role2")
        .setDescription("Optional second required role")
        .setRequired(false)
    )
    .addRoleOption(option =>
      option
        .setName("exclude")
        .setDescription("Optional role to exclude from results")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    const role1 = interaction.options.getRole("role1");
    const role2 = interaction.options.getRole("role2");
    const excludeRole = interaction.options.getRole("exclude");
    const guild = interaction.guild;

    if (!guild) {
      return interaction.editReply({
        content: "This command can only be used in a server."
      });
    }

    const { members: allMembers, withPresences } =
      await fetchMembersWithPresence(guild);

    const matches = [];

    for (const member of allMembers.values()) {
      if (member.user.bot) continue;
      if (!member.roles.cache.has(role1.id)) continue;
      if (role2 && !member.roles.cache.has(role2.id)) continue;
      if (excludeRole && member.roles.cache.has(excludeRole.id)) continue;
      if (!isConsideredOnline(member)) continue;
      matches.push(member);
    }

    matches.sort(compareDisplayNames);

    const fetchIncomplete = allMembers.size < guild.memberCount;
    const presenceUnavailable =
      !presenceIntentEnabled(guild) || !withPresences;
    const warnings = [];

    if (fetchIncomplete) {
      warnings.push(
        `Discord returned ${allMembers.size}/${guild.memberCount} members. Enable Server Members Intent, then restart.`
      );
    }

    if (presenceUnavailable) {
      warnings.push(
        "No online presence data. Enable Presence Intent in the Discord Developer Portal, then restart the bot."
      );
    }

    const warning = warnings.join(" ");

    const embeds =
      matches.length === 0
        ? [buildEmptyEmbed(role1, role2, excludeRole, warning)]
        : buildResultEmbeds(role1, role2, excludeRole, matches, warning);

    await interaction.editReply({
      embeds: [embeds[0]],
      allowedMentions: NO_PING_MENTIONS
    });

    for (let index = 1; index < embeds.length; index++) {
      await interaction.followUp({
        embeds: [embeds[index]],
        allowedMentions: NO_PING_MENTIONS
      });
    }
  }
};
