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
const PRESENCE_BATCH_SIZE = 100;
const PRESENCE_FETCH_TIME_MS = 90_000;
const PRESENCE_BATCH_TIME_MS = 30_000;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getDisplayName(member) {
  return (
    member.displayName ||
    member.user?.globalName ||
    member.user?.username ||
    member.id
  );
}

function getPresenceStatus(member) {
  return (
    member.presence?.status ||
    member.guild.presences.cache.get(member.id)?.status ||
    null
  );
}

function isConsideredOnline(member) {
  return ONLINE_STATUSES.has(getPresenceStatus(member));
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
  const header = buildFilterHeader(role1, role2, excludeRole);
  const body = warning
    ? warning
    : buildEmptyMessage(role1, role2, excludeRole);

  const embed = new EmbedBuilder()
    .setTitle("🟢 Online Members")
    .setColor(EMBED_COLOR)
    .setDescription(`${header}\n\n${body}`);

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

function matchesRoleFilters(member, role1, role2, excludeRole) {
  if (member.user.bot) return false;
  if (!member.roles.cache.has(role1.id)) return false;
  if (role2 && !member.roles.cache.has(role2.id)) return false;
  if (excludeRole && member.roles.cache.has(excludeRole.id)) return false;
  return true;
}

async function ensureMembersCached(guild) {
  if (guild.members.cache.size >= guild.memberCount) {
    return guild.members.cache;
  }

  try {
    return await guild.members.fetch();
  } catch (err) {
    console.error("[ONLINE] member fetch failed:", err?.message || err);
    return guild.members.cache;
  }
}

async function fetchAllMembersWithPresences(guild) {
  return guild.members.fetch({
    query: "",
    limit: 0,
    withPresences: true,
    time: PRESENCE_FETCH_TIME_MS
  });
}

async function fetchPresencesForIds(guild, ids) {
  for (let index = 0; index < ids.length; index += PRESENCE_BATCH_SIZE) {
    const batch = ids.slice(index, index + PRESENCE_BATCH_SIZE);
    let attempt = 0;

    while (attempt < 3) {
      try {
        await guild.members.fetch({
          user: batch,
          withPresences: true,
          time: PRESENCE_BATCH_TIME_MS
        });
        break;
      } catch (err) {
        attempt += 1;
        console.error(
          `[ONLINE] presence batch failed (${index}-${index + batch.length}):`,
          err?.message || err
        );

        if (attempt >= 3) {
          throw err;
        }

        await delay(5000);
      }
    }
  }
}

async function loadOnlineMatches(guild, role1, role2, excludeRole) {
  let presenceFetchComplete = false;

  try {
    await fetchAllMembersWithPresences(guild);
    presenceFetchComplete = guild.presences.cache.size > 0;
  } catch (err) {
    console.error("[ONLINE] full presence fetch failed:", err?.message || err);
  }

  const allMembers = await ensureMembersCached(guild);
  const candidates = [];

  for (const member of allMembers.values()) {
    if (matchesRoleFilters(member, role1, role2, excludeRole)) {
      candidates.push(member);
    }
  }

  const missingPresenceIds = candidates
    .filter(member => !guild.presences.cache.has(member.id))
    .map(member => member.id);

  if (!presenceFetchComplete && missingPresenceIds.length > 0) {
    try {
      await fetchPresencesForIds(guild, missingPresenceIds);
      presenceFetchComplete = true;
    } catch (err) {
      console.error("[ONLINE] candidate presence fetch failed:", err?.message || err);
    }
  }

  const matches = candidates.filter(isConsideredOnline).sort(compareDisplayNames);
  const presenceAvailable =
    presenceIntentEnabled(guild) &&
    (presenceFetchComplete ||
      matches.length > 0 ||
      guild.presences.cache.size > 0);

  console.log(
    `[ONLINE] members=${allMembers.size}/${guild.memberCount} ` +
      `presences=${guild.presences.cache.size} ` +
      `candidates=${candidates.length} matches=${matches.length} ` +
      `presenceAvailable=${presenceAvailable}`
  );

  return {
    matches,
    memberCount: allMembers.size,
    presenceAvailable
  };
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

    await interaction.editReply({
      content: "🔍 Fetching online members…"
    });

    const { matches, memberCount, presenceAvailable } = await loadOnlineMatches(
      guild,
      role1,
      role2,
      excludeRole
    );

    const warnings = [];

    if (memberCount < guild.memberCount) {
      warnings.push(
        `Discord returned ${memberCount}/${guild.memberCount} members. Enable Server Members Intent, then restart.`
      );
    }

    if (!presenceAvailable) {
      warnings.push(
        "Could not read Discord online status. Enable **Presence Intent** in the Discord Developer Portal (Bot → Privileged Gateway Intents), then restart the bot."
      );
    }

    const warning = warnings.join(" ");
    const embeds =
      matches.length === 0
        ? [buildEmptyEmbed(role1, role2, excludeRole, warning)]
        : buildResultEmbeds(role1, role2, excludeRole, matches, warning);

    await interaction.editReply({
      content: null,
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
