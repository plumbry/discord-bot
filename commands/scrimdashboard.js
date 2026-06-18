const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const {
  DEFAULT_DASHBOARD_CHANNEL_ID,
  getDashboard,
  upsertDashboard
} = require("../lib/scrimDashboardSheet");
const {
  ACTIONS,
  isActionReady,
  resolveDashboardChannels,
  resolvedChannelIds
} = require("../lib/scrimDashboardChannels");
const { startGameCall } = require("./gamecall");
const { runVodCheck } = require("./vodcheck");
const { runLiveCheck } = require("./checklive");
const { runTeamStreamCheck } = require("./teamstreamcheck");
const { runVoiceCheck, splitDiscordMessages } = require("./voicecheck");
const { runUnregisterTeam } = require("./unreg");
const { postDropmapClosed } = require("./dropmap");
const { runDropmapCheck } = require("./dropmapcheck");

const PREFIX = "scrimdash";
const pendingUnregs = new Map();

function userCanUse(member) {
  return Boolean(
    member?.permissions?.has(PermissionFlagsBits.Administrator) ||
    member?.permissions?.has(PermissionFlagsBits.ManageRoles)
  );
}

function prunePendingUnregs() {
  const cutoff = Date.now() - 10 * 60 * 1000;

  for (const [token, pending] of pendingUnregs.entries()) {
    if (pending.createdAt < cutoff) {
      pendingUnregs.delete(token);
    }
  }
}

function channelMention(id) {
  return id ? `<#${id}>` : "`Not configured`";
}

function roleMention(id) {
  return id ? `<@&${id}>` : "`Not configured`";
}

function categoryName(guild, id) {
  const channel = id ? guild.channels.cache.get(id) : null;
  return channel ? `${channel.name} (${channelMention(id)})` : "`Not configured`";
}

function statusLine(result) {
  if (!result) {
    return "`Not resolved`";
  }

  if (result.status === "ambiguous") {
    return "`Ambiguous` " + result.matches.map(channelMention).join(", ");
  }

  if (!result.channelId) {
    return "`Missing`";
  }

  const label = result.status === "overridden" ? "manual" : "auto";
  const warning = result.warning ? ` - ${result.warning}` : "";
  return `${channelMention(result.channelId)} \`${label}\`${warning}`;
}

function collectWarnings(record, results) {
  const warnings = [];

  if (!record?.activeCategoryId) {
    warnings.push("Missing active category");
  }

  if (!record?.activeRoleId) {
    warnings.push("Missing active role");
  }

  if (!record?.activeCategoryId) {
    return warnings;
  }

  for (const action of ACTIONS) {
    const result = results?.[action.key];

    if (!result) {
      warnings.push(`Missing channel: ${action.label}`);
      continue;
    }

    if (result.status === "missing") {
      warnings.push(`Missing channel: ${action.label}`);
    } else if (result.status === "ambiguous") {
      warnings.push(`Ambiguous channel: ${action.label}`);
    }

    if (result.warning) {
      warnings.push(`${action.label}: ${result.warning}`);
    }
  }

  return warnings;
}

function dashboardStatusLabel(record, warnings) {
  if (!record?.activeCategoryId || !record?.activeRoleId) {
    return "Setup required";
  }

  return warnings.length ? "Needs attention" : "Ready";
}

function compactStatusText(record, warnings) {
  if (!record?.activeCategoryId || !record?.activeRoleId) {
    return [
      "Select an active category and role below.",
      "",
      ...warnings
    ].join("\n");
  }

  if (!warnings.length) {
    return "All required routing is resolved. Dashboard actions are ready.";
  }

  return warnings.join("\n");
}

function buildDashboardPayload({ guild, record, results }) {
  const warnings = collectWarnings(record, results);
  const statusLabel = dashboardStatusLabel(record, warnings);
  const status = compactStatusText(record, warnings);
  const channelLines = ACTIONS.map(action => {
    return `**${action.label}**\n${statusLine(results?.[action.key])}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("Scrim Operations Dashboard")
    .setDescription(
      "Permanent staff control panel. Set the active scrim once, then use the action buttons below."
    )
    .setColor(warnings.length ? 0xffb000 : 0x22aa66)
    .addFields(
      {
        name: "Current Setup",
        value:
          `**Category**\n${categoryName(guild, record?.activeCategoryId)}\n\n` +
          `**Role**\n${roleMention(record?.activeRoleId)}`
      },
      {
        name: "Channel Routing",
        value: channelLines.join("\n\n")
      },
      {
        name: `Status: ${statusLabel}`,
        value: status.slice(0, 1024)
      }
    )
    .setFooter({
      text: `Use the dropdowns to update setup. Refreshed ${new Date().toISOString()}`
    });

  const hasRole = Boolean(record?.activeRoleId);
  const rows = [
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`${PREFIX}:select:category`)
        .setPlaceholder("Choose active scrim category")
        .setChannelTypes(ChannelType.GuildCategory)
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`${PREFIX}:select:role`)
        .setPlaceholder("Choose active scrim role")
        .setMinValues(1)
        .setMaxValues(1)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:gamecall`)
        .setLabel("Game Call")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!hasRole || !isActionReady(results, "gamecall")),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:vod`)
        .setLabel("VOD Check")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!isActionReady(results, "vod")),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:checklive`)
        .setLabel("Live Check")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!isActionReady(results, "checklive")),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:teamstreamcheck`)
        .setLabel("Twitch Links")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(
          !isActionReady(results, "unreg") ||
          !isActionReady(results, "teamstreamcheck")
        )
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:voicecheck`)
        .setLabel("Voice Check")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasRole || !isActionReady(results, "voicecheck")),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:unreg`)
        .setLabel("Unreg Team")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasRole || !isActionReady(results, "unreg")),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:dropmapcheck`)
        .setLabel("Dropmap Check")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(
          !isActionReady(results, "unreg") ||
          !isActionReady(results, "dropmapcheck")
        ),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:dropmapclosed`)
        .setLabel("Dropmap Closed")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!isActionReady(results, "dropmapclosed"))
    )
  ];

  return {
    content: "",
    embeds: [embed],
    components: rows
  };
}

async function getDashboardContext(guild, baseRecord = null) {
  const record = baseRecord || await getDashboard(guild.id);

  if (!record) {
    return { record: null, dashboardChannel: null, results: {} };
  }

  const dashboardChannel = await guild.channels
    .fetch(record.dashboardChannelId || DEFAULT_DASHBOARD_CHANNEL_ID)
    .catch(() => null);

  const results = resolveDashboardChannels({
    guild,
    categoryId: record.activeCategoryId,
    dashboardChannel,
    overrides: record.channelOverrides || {}
  });

  return { record, dashboardChannel, results };
}

async function saveResolvedRecord(guild, record, results) {
  return upsertDashboard({
    ...record,
    guildId: guild.id,
    resolvedChannels: resolvedChannelIds(results)
  });
}

async function ensureDashboardMessage(guild, record) {
  const dashboardChannelId =
    record.dashboardChannelId || DEFAULT_DASHBOARD_CHANNEL_ID;
  const dashboardChannel = await guild.channels
    .fetch(dashboardChannelId)
    .catch(() => null);

  if (!dashboardChannel?.isTextBased?.()) {
    throw new Error("Dashboard channel was not found or is not text-based.");
  }

  const { results } = await getDashboardContext(guild, {
    ...record,
    dashboardChannelId
  });

  const saved = await saveResolvedRecord(
    guild,
    { ...record, dashboardChannelId },
    results
  );
  const payload = buildDashboardPayload({
    guild,
    record: saved,
    results
  });

  let message = null;

  if (saved.dashboardMessageId) {
    message = await dashboardChannel.messages
      .fetch(saved.dashboardMessageId)
      .catch(() => null);
  }

  if (!message) {
    const recent = await dashboardChannel.messages
      .fetch({ limit: 25 })
      .catch(() => null);

    message = recent?.find(candidate => {
      return (
        candidate.author?.id === guild.client.user.id &&
        candidate.embeds?.[0]?.title === "Scrim Operations Dashboard"
      );
    }) || null;
  }

  if (message) {
    await message.edit(payload);
    return upsertDashboard({
      ...saved,
      dashboardMessageId: message.id,
      resolvedChannels: resolvedChannelIds(results)
    });
  }

  message = await dashboardChannel.send(payload);

  return upsertDashboard({
    ...saved,
    dashboardMessageId: message.id,
    resolvedChannels: resolvedChannelIds(results)
  });
}

async function refreshDashboardMessage(guild, record = null) {
  const current = record || await getDashboard(guild.id);

  if (!current) {
    throw new Error("Dashboard has not been set up yet.");
  }

  return ensureDashboardMessage(guild, current);
}

async function requireDashboardContext(interaction) {
  const guild = interaction.guild;
  const { record, dashboardChannel, results } =
    await getDashboardContext(guild);

  if (!record) {
    throw new Error("Dashboard has not been set up. Run /scrimdashboard setup.");
  }

  return { guild, record, dashboardChannel, results };
}

function getResolvedChannel(guild, results, key) {
  const result = results?.[key];

  if (!result?.channelId) {
    throw new Error(`${key} channel is not resolved.`);
  }

  const channel = guild.channels.cache.get(result.channelId);

  if (!channel?.isTextBased?.()) {
    throw new Error(`${key} channel is not available.`);
  }

  return channel;
}

function buildGameCallModal() {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:gamecall`)
    .setTitle("Start Game Call")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("code")
          .setLabel("Game code")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(32)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("region")
          .setLabel("Region (NAC or EU)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(8)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("minutes")
          .setLabel("Countdown minutes")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2)
      )
    );
}

function buildVodModal() {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:vod`)
    .setTitle("Run VOD Check")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("date")
          .setLabel("Date (YYYY-MM-DD)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("start")
          .setLabel("Start time UTC (HH:MM)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(5)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("end")
          .setLabel("End time UTC (HH:MM)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(5)
      )
    );
}

function buildUnregModal() {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:unreg`)
    .setTitle("Unregister Team")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("team_number")
          .setLabel("Team number")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(5)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("players")
          .setLabel("Optional player mentions or IDs")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("notify")
          .setLabel("Notify mode: silent or tag_remaining")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue("silent")
          .setMaxLength(20)
      )
    );
}

function buildTeamStreamModal() {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:teamstreamcheck`)
    .setTitle("Twitch Links Check")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("gamemode")
          .setLabel("Gamemode: smallteam or squads")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue("smallteam")
          .setMaxLength(16)
      )
    );
}

async function sendLongResult(channel, text) {
  const chunks = splitDiscordMessages(text);
  const messages = [];

  for (const chunk of chunks) {
    messages.push(await channel.send(chunk));
  }

  return messages;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("scrimdashboard")
    .setDescription("Manage the permanent scrim operations dashboard")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub =>
      sub
        .setName("setup")
        .setDescription("Create or repair the permanent dashboard message")
    )
    .addSubcommand(sub =>
      sub
        .setName("set")
        .setDescription("Set the active scrim category and role")
        .addChannelOption(option =>
          option
            .setName("category")
            .setDescription("Active scrim category")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Active scrim role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("refresh")
        .setDescription("Refresh channel resolution and dashboard message")
    ),

  async execute(interaction) {
    if (!userCanUse(interaction.member)) {
      return interaction.reply({
        content: "You need Manage Roles to use the scrim dashboard.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();
    const existing = await getDashboard(interaction.guildId);

    if (subcommand === "setup") {
      const record = await upsertDashboard({
        ...(existing || {}),
        guildId: interaction.guildId,
        dashboardChannelId: DEFAULT_DASHBOARD_CHANNEL_ID
      });

      const saved = await ensureDashboardMessage(interaction.guild, record);

      return interaction.editReply(
        `Dashboard ready in <#${saved.dashboardChannelId}>.`
      );
    }

    if (subcommand === "set") {
      const category = interaction.options.getChannel("category");
      const role = interaction.options.getRole("role");
      const base = existing || {
        guildId: interaction.guildId,
        dashboardChannelId: DEFAULT_DASHBOARD_CHANNEL_ID
      };

      const saved = await refreshDashboardMessage(
        interaction.guild,
        await upsertDashboard({
          ...base,
          activeCategoryId: category.id,
          activeRoleId: role.id
        })
      );

      return interaction.editReply(
        `Dashboard updated: category ${category}, role ${role}.`
      );
    }

    if (subcommand === "refresh") {
      await refreshDashboardMessage(interaction.guild, existing);
      return interaction.editReply("Dashboard refreshed.");
    }

    return interaction.editReply("Unknown dashboard subcommand.");
  },

  async handleSelectMenu(interaction) {
    if (!interaction.customId.startsWith(`${PREFIX}:select:`)) {
      return false;
    }

    if (!userCanUse(interaction.member)) {
      await interaction.reply({
        content: "You need Manage Roles to configure the scrim dashboard.",
        ephemeral: true
      });
      return true;
    }

    const selectedId = interaction.values?.[0];

    if (!selectedId) {
      await interaction.reply({
        content: "No selection was received.",
        ephemeral: true
      });
      return true;
    }

    const type = interaction.customId.split(":")[2];

    if (type !== "category" && type !== "role") {
      return false;
    }

    await interaction.deferUpdate();

    const existing = await getDashboard(interaction.guildId);
    const base = existing || {
      guildId: interaction.guildId,
      dashboardChannelId: interaction.channelId || DEFAULT_DASHBOARD_CHANNEL_ID,
      dashboardMessageId: interaction.message?.id || ""
    };

    const next = {
      ...base,
      dashboardChannelId:
        base.dashboardChannelId || interaction.channelId || DEFAULT_DASHBOARD_CHANNEL_ID,
      dashboardMessageId: base.dashboardMessageId || interaction.message?.id || ""
    };

    if (type === "category") {
      next.activeCategoryId = selectedId;
    } else {
      next.activeRoleId = selectedId;
    }

    const savedBase = await upsertDashboard(next);
    const { results } = await getDashboardContext(
      interaction.guild,
      savedBase
    );
    const saved = await saveResolvedRecord(
      interaction.guild,
      savedBase,
      results
    );

    await interaction.message.edit(
      buildDashboardPayload({
        guild: interaction.guild,
        record: saved,
        results
      })
    );

    return true;
  },

  async handleButton(interaction) {
    if (!interaction.customId.startsWith(`${PREFIX}:`)) {
      return false;
    }

    if (!userCanUse(interaction.member)) {
      await interaction.reply({
        content: "You need Manage Roles to use the scrim dashboard.",
        ephemeral: true
      });
      return true;
    }

    prunePendingUnregs();

    const action = interaction.customId.split(":")[1];

    if (action === "gamecall") {
      await interaction.showModal(buildGameCallModal());
      return true;
    }

    if (action === "vod") {
      await interaction.showModal(buildVodModal());
      return true;
    }

    if (action === "teamstreamcheck") {
      await interaction.showModal(buildTeamStreamModal());
      return true;
    }

    if (action === "unreg") {
      await interaction.showModal(buildUnregModal());
      return true;
    }

    if (action === "confirm_unreg" || action === "cancel_unreg") {
      const token = interaction.customId.split(":")[2];
      const pending = pendingUnregs.get(token);

      if (!pending || pending.userId !== interaction.user.id) {
        await interaction.update({
          content: "This unregister confirmation has expired.",
          components: []
        });
        return true;
      }

      if (action === "cancel_unreg") {
        pendingUnregs.delete(token);
        await interaction.update({
          content: "Unregister cancelled.",
          components: []
        });
        return true;
      }

      pendingUnregs.delete(token);
      await interaction.update({
        content: `Processing unregister for team **${pending.teamNumber}**...`,
        components: []
      });

      const { guild, record, results } =
        await requireDashboardContext(interaction);
      const role = guild.roles.cache.get(record.activeRoleId);

      if (!role) {
        await interaction.followUp({
          content: "Active role no longer exists.",
          ephemeral: true
        });
        return true;
      }

      const channel = getResolvedChannel(guild, results, "unreg");
      const result = await runUnregisterTeam({
        channel,
        guild,
        teamNumber: pending.teamNumber,
        role,
        playersValue: pending.playersValue,
        notifyMode: pending.notifyMode,
        moderator: interaction.user
      });

      await sendLongResult(channel, result);
      await interaction.followUp({
        content: `Unregister complete. Result posted in ${channel}.`,
        ephemeral: true
      });
      return true;
    }

    if (action === "voicecheck") {
      await interaction.deferReply({ ephemeral: true });
      const { guild, record, results } =
        await requireDashboardContext(interaction);
      const role = guild.roles.cache.get(record.activeRoleId);

      if (!role) {
        await interaction.editReply("Active role no longer exists.");
        return true;
      }

      const channel = getResolvedChannel(guild, results, "voicecheck");
      const category = guild.channels.cache.get(record.activeCategoryId);
      const { report } = await runVoiceCheck({
        guild,
        role,
        checkedBy: `<@${interaction.user.id}>`
      });

      await sendLongResult(
        channel,
        `Voice check for **${category?.name || "active scrim"}**\n\n${report}`
      );
      await interaction.editReply(`Voice check posted in ${channel}.`);
      return true;
    }

    if (action === "checklive") {
      await interaction.deferReply({ ephemeral: true });
      const { guild, results } = await requireDashboardContext(interaction);
      const channel = getResolvedChannel(guild, results, "checklive");

      await interaction.editReply(`Running live check in ${channel}...`);

      const { message } = await runLiveCheck({
        channel,
        user: interaction.user
      });

      await sendLongResult(channel, message);
      await interaction.editReply(`Live check posted in ${channel}.`);
      return true;
    }

    if (action === "dropmapcheck") {
      await interaction.deferReply({ ephemeral: true });
      const { guild, results } = await requireDashboardContext(interaction);
      const signupChannel = getResolvedChannel(guild, results, "unreg");
      const dropmapChannel = getResolvedChannel(guild, results, "dropmapcheck");
      const { chunks } = await runDropmapCheck({
        signupChannel,
        dropmapChannel
      });

      for (const chunk of chunks) {
        await dropmapChannel.send(chunk);
      }

      await interaction.editReply(`Dropmap check posted in ${dropmapChannel}.`);
      return true;
    }

    if (action === "dropmapclosed") {
      await interaction.deferReply({ ephemeral: true });
      const { guild, results } = await requireDashboardContext(interaction);
      const channel = getResolvedChannel(guild, results, "dropmapclosed");

      await postDropmapClosed(channel);
      await interaction.editReply(`Dropmap closed message posted in ${channel}.`);
      return true;
    }

    return false;
  },

  async handleModalSubmit(interaction) {
    if (!interaction.customId.startsWith(`${PREFIX}:modal:`)) {
      return false;
    }

    if (!userCanUse(interaction.member)) {
      await interaction.reply({
        content: "You need Manage Roles to use the scrim dashboard.",
        ephemeral: true
      });
      return true;
    }

    const modal = interaction.customId.split(":")[2];

    if (modal === "gamecall") {
      await interaction.deferReply({ ephemeral: true });
      const { guild, record, results } =
        await requireDashboardContext(interaction);
      const role = guild.roles.cache.get(record.activeRoleId);
      const channel = getResolvedChannel(guild, results, "gamecall");
      const code = interaction.fields.getTextInputValue("code").trim();
      const region = interaction.fields
        .getTextInputValue("region")
        .trim()
        .toUpperCase();
      const minutes = Number(
        interaction.fields.getTextInputValue("minutes").trim()
      );

      if (!role) {
        await interaction.editReply("Active role no longer exists.");
        return true;
      }

      if (!["NAC", "EU"].includes(region)) {
        await interaction.editReply("Region must be NAC or EU.");
        return true;
      }

      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
        await interaction.editReply("Minutes must be a whole number from 1 to 60.");
        return true;
      }

      const { game } = await startGameCall({
        channel,
        role,
        code,
        region,
        minutes
      });

      await interaction.editReply(`Game ${game} call started in ${channel}.`);
      return true;
    }

    if (modal === "vod") {
      await interaction.deferReply({ ephemeral: true });
      const { guild, results } = await requireDashboardContext(interaction);
      const channel = getResolvedChannel(guild, results, "vod");
      const date = interaction.fields.getTextInputValue("date").trim();
      const startTime = interaction.fields.getTextInputValue("start").trim();
      const endTime = interaction.fields.getTextInputValue("end").trim();

      await interaction.editReply(`Scanning VODs in ${channel}...`);

      const { summary } = await runVodCheck({
        channel,
        date,
        startTime,
        endTime,
        user: interaction.user
      });

      await sendLongResult(channel, summary);
      await interaction.editReply(`VOD check posted in ${channel}.`);
      return true;
    }

    if (modal === "teamstreamcheck") {
      await interaction.deferReply({ ephemeral: true });
      const { guild, results } = await requireDashboardContext(interaction);
      const signupChannel = getResolvedChannel(guild, results, "unreg");
      const streamChannel = getResolvedChannel(
        guild,
        results,
        "teamstreamcheck"
      );
      const gamemode = interaction.fields
        .getTextInputValue("gamemode")
        .trim()
        .toLowerCase();

      if (!["smallteam", "squads"].includes(gamemode)) {
        await interaction.editReply("Gamemode must be smallteam or squads.");
        return true;
      }

      await interaction.editReply(`Checking Twitch links in ${streamChannel}...`);

      const { output } = await runTeamStreamCheck({
        signupChannel,
        streamChannel,
        gamemode
      });

      await sendLongResult(streamChannel, output);
      await interaction.editReply(`Twitch Links check posted in ${streamChannel}.`);
      return true;
    }

    if (modal === "unreg") {
      const teamNumber = Number(
        interaction.fields.getTextInputValue("team_number").trim()
      );
      const playersValue =
        interaction.fields.getTextInputValue("players").trim();
      const notifyMode = interaction.fields
        .getTextInputValue("notify")
        .trim()
        .toLowerCase();

      if (!Number.isInteger(teamNumber) || teamNumber < 1) {
        await interaction.reply({
          content: "Team number must be a positive whole number.",
          ephemeral: true
        });
        return true;
      }

      if (!["silent", "tag_remaining"].includes(notifyMode)) {
        await interaction.reply({
          content: "Notify mode must be silent or tag_remaining.",
          ephemeral: true
        });
        return true;
      }

      const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      pendingUnregs.set(token, {
        userId: interaction.user.id,
        teamNumber,
        playersValue,
        notifyMode,
        createdAt: Date.now()
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${PREFIX}:confirm_unreg:${token}`)
          .setLabel("Confirm Unregister")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`${PREFIX}:cancel_unreg:${token}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        content:
          "**Confirm unregister**\n" +
          `Team: **${teamNumber}**\n` +
          `Players: ${playersValue || "whole team"}\n` +
          `Notify: ${notifyMode}\n\n` +
          "This will remove the active role and delete the signup message.",
        components: [row],
        ephemeral: true
      });
      return true;
    }

    return false;
  },

  async restoreScrimDashboard(client) {
    const guildId = process.env.GUILD_ID || "1371615693392576580";
    const guild = await client.guilds.fetch(guildId)
      .catch(() => null);

    if (!guild) {
      console.warn("[SCRIM DASHBOARD] Guild not found during restore.");
      return;
    }

    const record = await getDashboard(guild.id).catch(err => {
      console.error("[SCRIM DASHBOARD] Could not load Dashboard sheet:", err);
      return null;
    });

    if (!record) {
      console.log("[SCRIM DASHBOARD] No Dashboard row to restore.");
      return;
    }

    try {
      await refreshDashboardMessage(guild, record);
      console.log("[SCRIM DASHBOARD] Restored permanent dashboard.");
    } catch (err) {
      console.error("[SCRIM DASHBOARD] Restore failed:", err?.message || err);
    }
  }
};
