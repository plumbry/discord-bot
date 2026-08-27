const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder
} = require("discord.js");
const crypto = require("crypto");

const { getSheets } = require("../lib/sheets");
const {
  LOG_CHANNEL_ID,
  AUDIT_RANGE,
  scanGuildMembers,
  formatJoinedDate,
  buildCsv,
  userCanPrune,
  userCanKickPrune,
  getProtectedReason,
  defaultProtectedRoleIds
} = require("../lib/inactivePrune");

const PREFIX = "pruneinactive";
const PENDING_TTL_MS = 20 * 60 * 1000;
const PAGE_SIZE = 20;
const KICK_DELAY_MS = 1100;
const EMBED_COLOR = 0x5865f2;
const NO_PING = { parse: [] };

const pendingScans = new Map();

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function prunePending() {
  const now = Date.now();

  for (const [token, job] of pendingScans.entries()) {
    if (now - job.createdAt > PENDING_TTL_MS) {
      pendingScans.delete(token);
    }
  }
}

function deny(interaction, content) {
  const payload = { content, ephemeral: true };

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }

  return interaction.reply(payload);
}

function buildSummaryEmbed(scan) {
  const { counts, yunite, minAgeDays } = scan;
  const warnings = [];

  if (!yunite.apiConfigured) {
    warnings.push(
      "YUNITE_API_KEY is not set, so tournament status is unknown for everyone."
    );
  } else if (!yunite.loaded) {
    warnings.push(
      `Yunite tournament data was not fully loaded (${yunite.reason || "unknown error"}).`
    );
  } else if (yunite.leaderboardFailures > 0) {
    warnings.push(
      `${yunite.leaderboardFailures} Yunite leaderboard(s) failed; unmatched members stay unknown.`
    );
  }

  if (!scan.activityComplete) {
    warnings.push(
      "Some stored activity sources failed to load, so nobody is marked eligible."
    );
  }

  const embed = new EmbedBuilder()
    .setTitle("Inactive Member Review")
    .setColor(EMBED_COLOR)
    .setDescription(
      [
        `Members checked: **${counts.checked}**`,
        `Eligible to prune: **${counts.eligible}**`,
        `Played an event: **${counts.played}**`,
        `Have interacted: **${counts.interacted}**`,
        `Too new: **${counts.tooNew}** (under ${minAgeDays} days)`,
        `Unknown tournament status: **${counts.unknown}**`,
        `Protected/excluded: **${counts.protected}**`
      ].join("\n")
    )
    .setFooter({
      text:
        "Interaction uses stored bot records only (LFG, AnonQ, event bans, verification sheets). Discord does not provide historical message counts."
    });

  if (warnings.length) {
    embed.addFields({
      name: "Notes",
      value: warnings.join("\n").slice(0, 1024)
    });
  }

  return embed;
}

function mainButtons(token, eligibleCount) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:view_eligible:${token}:0`)
      .setLabel("View Eligible")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(eligibleCount === 0),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:view_unknown:${token}:0`)
      .setLabel("View Unknown")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:export:${token}`)
      .setLabel("Export CSV")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:kick:${token}`)
      .setLabel("Kick Eligible")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(eligibleCount === 0)
  );
}

function pageButtons(token, kind, page, pageCount) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:view_${kind}:${token}:${Math.max(0, page - 1)}`)
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(
          `${PREFIX}:view_${kind}:${token}:${Math.min(pageCount - 1, page + 1)}`
        )
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pageCount - 1),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:back:${token}`)
        .setLabel("Back")
        .setStyle(ButtonStyle.Primary)
    )
  ];

  return rows;
}

function kickConfirmButtons(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:kick_confirm:${token}`)
      .setLabel("Confirm Kick")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:kick_cancel:${token}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildListEmbed(title, records, page) {
  const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const start = safePage * PAGE_SIZE;
  const slice = records.slice(start, start + PAGE_SIZE);
  const lines = slice.map(record => {
    const joined = formatJoinedDate(record.joinedTimestamp);
    return `• <@${record.id}> \`${record.id}\` — joined ${joined}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(EMBED_COLOR)
    .setDescription(
      records.length === 0
        ? "None."
        : lines.join("\n").slice(0, 4096)
    )
    .setFooter({
      text: `Page ${safePage + 1}/${pages} • ${records.length} member(s)`
    });

  return { embed, page: safePage, pageCount: pages };
}

async function logAuditRow(values) {
  if (!process.env.MAIN_SHEET_ID) {
    return;
  }

  try {
    await getSheets().spreadsheets.values.append({
      spreadsheetId: process.env.MAIN_SHEET_ID,
      range: AUDIT_RANGE,
      valueInputOption: "RAW",
      requestBody: { values: [values] }
    });
  } catch (err) {
    console.error("[PRUNE] Audit sheet write failed:", err?.message || err);
  }
}

async function logChannel(guild, content) {
  try {
    const channel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

    if (channel?.isTextBased?.()) {
      await channel.send({ content, allowedMentions: NO_PING });
    }
  } catch (err) {
    console.error("[PRUNE] Log channel write failed:", err?.message || err);
  }
}

async function showSummary(interaction, job) {
  await interaction.editReply({
    content: null,
    embeds: [buildSummaryEmbed(job.scan)],
    components: [mainButtons(job.token, job.scan.counts.eligible)],
    allowedMentions: NO_PING
  });
}

async function kickEligibleMembers(interaction, job) {
  const guild = interaction.guild;
  const eligible = job.scan.eligible.filter(record => record.eligible);
  const kicked = [];
  const skipped = [];

  await interaction.editReply({
    content: `Kicking **${eligible.length}** eligible member(s). This may take a few minutes…`,
    embeds: [],
    components: []
  });

  await logChannel(
    guild,
    `🧹 Inactive prune started by <@${interaction.user.id}> (${interaction.user.tag}). ` +
      `Attempting **${eligible.length}** kick(s).`
  );

  await logAuditRow([
    new Date().toISOString(),
    interaction.user.id,
    interaction.user.tag,
    "",
    "",
    guild.id,
    `PRUNE_INACTIVE_START (${eligible.length})`
  ]);

  for (const record of eligible) {
    if (record.id === interaction.user.id) {
      skipped.push({ ...record, skipReason: "command invoker" });
      continue;
    }

    const member = await guild.members.fetch(record.id).catch(() => null);

    if (!member) {
      skipped.push({ ...record, skipReason: "no longer in server" });
      continue;
    }

    if (member.user?.bot) {
      skipped.push({ ...record, skipReason: "bot" });
      continue;
    }

    if (!member.kickable) {
      skipped.push({ ...record, skipReason: "not kickable" });
      continue;
    }

    const protectedReason = getProtectedReason(
      member,
      defaultProtectedRoleIds(),
      interaction.user.id
    );

    if (protectedReason) {
      skipped.push({ ...record, skipReason: protectedReason });
      continue;
    }

    try {
      await member.kick(
        `Inactive prune by ${interaction.user.tag}: ${record.eligibilityReason}`
      );
      kicked.push(record);
      console.log(
        `[PRUNE] kicked ${record.tag} (${record.id}) by ${interaction.user.tag}`
      );

      await logAuditRow([
        new Date().toISOString(),
        interaction.user.id,
        interaction.user.tag,
        record.id,
        record.tag,
        guild.id,
        "PRUNE_INACTIVE_KICK"
      ]);
    } catch (err) {
      const status = err?.status || err?.httpStatus;
      skipped.push({
        ...record,
        skipReason: err?.message || "kick failed"
      });
      console.error(
        `[PRUNE] kick failed ${record.id}:`,
        err?.message || err
      );

      if (status === 429) {
        const retryAfter = Number(err?.retryAfter || 2);
        await delay(Math.max(KICK_DELAY_MS, retryAfter * 1000));
        continue;
      }
    }

    await delay(KICK_DELAY_MS);
  }

  job.scan.eligible = [];
  job.scan.counts.eligible = 0;

  const summary =
    `**Inactive prune complete**\n` +
    `Initiated by: <@${interaction.user.id}>\n` +
    `Kicked: **${kicked.length}**\n` +
    `Skipped: **${skipped.length}**`;

  await logChannel(guild, summary.replace(/\*\*/g, ""));

  await logAuditRow([
    new Date().toISOString(),
    interaction.user.id,
    interaction.user.tag,
    "",
    "",
    guild.id,
    `PRUNE_INACTIVE_COMPLETE kicked=${kicked.length} skipped=${skipped.length}`
  ]);

  const files = [];

  if (kicked.length > 0) {
    files.push(
      new AttachmentBuilder(Buffer.from(buildCsv(kicked), "utf8"), {
        name: `prune-kicked-${Date.now()}.csv`
      })
    );
  }

  await interaction.editReply({
    content: summary,
    files,
    allowedMentions: NO_PING
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pruneinactive")
    .setDescription("Preview members who appear inactive and have never played a ZBD event")
    .addIntegerOption(option =>
      option
        .setName("days")
        .setDescription("Minimum days since joining (default 30)")
        .setMinValue(1)
        .setMaxValue(3650)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    if (!userCanPrune(interaction.member)) {
      return deny(
        interaction,
        "You need the existing ZBD staff/admin permission to use this command."
      );
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    const minAgeDays = interaction.options.getInteger("days") || 30;

    await interaction.editReply({
      content:
        "Scanning members, stored activity, and Yunite tournament results. This can take a minute…"
    });

    let scan;

    try {
      scan = await scanGuildMembers(interaction.guild, {
        minAgeDays,
        invokerId: interaction.user.id
      });
    } catch (err) {
      console.error("[PRUNE] scan failed:", err?.message || err);
      return interaction.editReply({
        content: `Scan failed: ${err?.message || "unknown error"}`
      });
    }

    prunePending();

    const token = crypto.randomUUID();
    const job = {
      token,
      createdAt: Date.now(),
      userId: interaction.user.id,
      guildId: interaction.guildId,
      scan
    };

    pendingScans.set(token, job);

    await interaction.editReply({
      content: null,
      embeds: [buildSummaryEmbed(scan)],
      components: [mainButtons(token, scan.counts.eligible)],
      allowedMentions: NO_PING
    });
  },

  async handleButton(interaction) {
    if (!interaction.customId.startsWith(`${PREFIX}:`)) {
      return false;
    }

    prunePending();

    const parts = interaction.customId.split(":");
    const action = parts[1];
    const token = parts[2];
    const job = pendingScans.get(token);

    if (!job) {
      await interaction.reply({
        content: "This prune preview has expired. Run `/pruneinactive` again.",
        ephemeral: true
      });
      return true;
    }

    if (interaction.user.id !== job.userId) {
      await interaction.reply({
        content: "Only the admin who ran `/pruneinactive` can use these buttons.",
        ephemeral: true
      });
      return true;
    }

    if (!userCanPrune(interaction.member)) {
      await interaction.reply({
        content: "You no longer have permission to use this command.",
        ephemeral: true
      });
      return true;
    }

    if (action === "back" || action === "kick_cancel") {
      await interaction.deferUpdate();
      await showSummary(interaction, job);
      return true;
    }

    if (action === "view_eligible" || action === "view_unknown") {
      const kind = action === "view_eligible" ? "eligible" : "unknown";
      const page = Number(parts[3] || 0) || 0;
      const records = kind === "eligible" ? job.scan.eligible : job.scan.unknown;
      const { embed, page: safePage, pageCount } = buildListEmbed(
        kind === "eligible" ? "Eligible to prune" : "Unknown tournament status",
        records,
        page
      );

      await interaction.update({
        content: null,
        embeds: [embed],
        components: pageButtons(token, kind, safePage, pageCount),
        allowedMentions: NO_PING
      });
      return true;
    }

    if (action === "export") {
      const stamp = Date.now();
      const files = [
        new AttachmentBuilder(Buffer.from(buildCsv(job.scan.records), "utf8"), {
          name: `pruneinactive-all-${stamp}.csv`
        })
      ];

      if (job.scan.eligible.length > 0) {
        files.push(
          new AttachmentBuilder(Buffer.from(buildCsv(job.scan.eligible), "utf8"), {
            name: `pruneinactive-eligible-${stamp}.csv`
          })
        );
      }

      await interaction.reply({
        content:
          `CSV export of **${job.scan.records.length}** scanned member(s)` +
          (job.scan.eligible.length
            ? ` (**${job.scan.eligible.length}** eligible).`
            : "."),
        files,
        ephemeral: true
      });
      return true;
    }

    if (action === "kick") {
      if (!userCanKickPrune(interaction.member)) {
        await interaction.reply({
          content: "You need **Kick Members** as well as staff permission to kick.",
          ephemeral: true
        });
        return true;
      }

      const botMember = interaction.guild.members.me;
      if (!botMember?.permissions.has(PermissionFlagsBits.KickMembers)) {
        await interaction.reply({
          content: "I need the **Kick Members** permission to prune members.",
          ephemeral: true
        });
        return true;
      }

      const count = job.scan.eligible.length;
      await interaction.update({
        content:
          `You are about to kick **${count}** members. This cannot be undone. Confirm?`,
        embeds: [],
        components: [kickConfirmButtons(token)]
      });
      return true;
    }

    if (action === "kick_confirm") {
      if (!userCanKickPrune(interaction.member)) {
        await interaction.reply({
          content: "You need **Kick Members** as well as staff permission to kick.",
          ephemeral: true
        });
        return true;
      }

      await interaction.deferUpdate();
      await kickEligibleMembers(interaction, job);
      pendingScans.delete(token);
      return true;
    }

    return true;
  }
};
