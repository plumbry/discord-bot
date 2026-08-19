const { SlashCommandBuilder } = require("discord.js");

const { userIsStaff } = require("../lib/staffPermissions");

const {
  respondScheduledEventAutocomplete,
  resolveScheduledEvent,
  fetchGuildScheduledEvents
} = require("../lib/guildScheduledEvents");

const {
  listTierRulesets,
  getTierRuleset,
  resolveRulesetId
} = require("../lib/tierRestrictions");

const {
  teamSizeFromFormat,
  formatLabel
} = require("../lib/genderRestrictions");

const {
  upsertLfgEvent,
  getLfgEvent,
  listLfgEvents,
  createLfgRequest,
  updateLfgRequest,
  getLfgRequest,
  getActiveRequestForUser,
  listActiveRequestsForUser,
  getLfgMatch,
  isLfgPostOpen
} = require("../lib/lfgSheet");

const {
  readPlayerProfile,
  formatProfileIssue,
  validateRequestMembers
} = require("../lib/lfgEligibility");

const {
  recalculateMatches,
  recordInterest,
  dismissMatch,
  stopLooking,
  probeDm,
  countMatchStats
} = require("../lib/lfgMatching");

const {
  listOpenLfgEvents,
  expireLfgEvent,
  endLfgPost,
  shortWhenLabel
} = require("../lib/lfgExpiry");

const {
  CUSTOM,
  isLfgCustomId,
  requestStatusLine,
  eventSelectRow,
  typeButtonRows,
  teammateSelectRow,
  notePromptRows,
  noteModal,
  manageRows,
  dmProbeContent,
  dmDisabledWarning
} = require("../lib/lfgUi");

const FLOW_TTL_MS = 10 * 60 * 1000;
const playerFlows = new Map();

function setFlow(userId, data) {
  playerFlows.set(userId, {
    ...data,
    expiresAt: Date.now() + FLOW_TTL_MS
  });
}

function getFlow(userId) {
  const flow = playerFlows.get(userId);

  if (!flow || flow.expiresAt < Date.now()) {
    playerFlows.delete(userId);
    return null;
  }

  return flow;
}

function clearFlow(userId) {
  playerFlows.delete(userId);
}

async function resolveGuild(interaction, guildId) {
  if (interaction.guild) {
    return interaction.guild;
  }

  if (!guildId) {
    return null;
  }

  return (
    interaction.client.guilds.cache.get(guildId) ||
    (await interaction.client.guilds.fetch(guildId).catch(() => null))
  );
}

function maxTeammates(teamSize) {
  return teamSize - 2;
}

function typePrompt(eventConfig) {
  return [
    `**${eventConfig.eventName}**`,
    `${formatLabel(eventConfig.format)} · looking for ${eventConfig.teamSize}`,
    "",
    "What are you looking for?"
  ].join("\n");
}

async function replyOrUpdate(interaction, payload) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(payload);
  }

  if (interaction.isMessageComponent?.()) {
    return interaction.update(payload);
  }

  return interaction.reply({ ...payload, ephemeral: true });
}

async function requireOpenEvent(guild, eventId) {
  const open = await listOpenLfgEvents(guild);
  return open.find(event => event.discordEventId === eventId) || null;
}

async function submitRequest(interaction, flow, note) {
  const guild = interaction.guild;
  const eventConfig = await requireOpenEvent(guild, flow.eventId);

  if (!eventConfig) {
    clearFlow(interaction.user.id);
    return replyOrUpdate(interaction, {
      content: "That event is no longer available for LFG.",
      components: []
    });
  }

  const ownerProfile = await readPlayerProfile(guild, interaction.user.id);

  if (!ownerProfile.ok) {
    clearFlow(interaction.user.id);
    return replyOrUpdate(interaction, {
      content: `I couldn't start LFG for you.\n${formatProfileIssue(ownerProfile)}`,
      components: []
    });
  }

  const memberUserIds = [interaction.user.id, ...(flow.teammateIds || [])];
  const validation = await validateRequestMembers(
    guild,
    memberUserIds,
    eventConfig
  );

  if (!validation.ok) {
    return replyOrUpdate(interaction, {
      content: validation.message,
      components: []
    });
  }

  const statusLine = requestStatusLine(
    {
      type: flow.type,
      memberUserIds
    },
    eventConfig.teamSize
  );

  const dmOk = await probeDm(
    interaction.client,
    interaction.user.id,
    dmProbeContent(eventConfig.eventName, statusLine)
  );

  if (!dmOk) {
    clearFlow(interaction.user.id);
    return replyOrUpdate(interaction, {
      content: dmDisabledWarning(),
      components: []
    });
  }

  const existing = await getActiveRequestForUser(
    eventConfig.discordEventId,
    interaction.user.id
  );

  let request;

  if (existing) {
    request = await updateLfgRequest(existing.id, {
      type: flow.type,
      memberUserIds,
      note: note || "",
      active: true,
      dmOk: true,
      closedAt: "",
      closedReason: ""
    });
  } else {
    request = await createLfgRequest({
      eventId: eventConfig.discordEventId,
      guildId: guild.id,
      ownerUserId: interaction.user.id,
      type: flow.type,
      memberUserIds,
      note: note || "",
      active: true,
      dmOk: true
    });
  }

  clearFlow(interaction.user.id);

  recalculateMatches(guild, eventConfig).catch(err => {
    console.error("[LFG] match recalculation failed:", err?.message || err);
  });

  const updated = existing ? "updated" : "started";

  return replyOrUpdate(interaction, {
    content: [
      `✅ LFG ${updated} for **${eventConfig.eventName}**.`,
      "",
      `Status: ${statusLine}`,
      note ? `Note: ${note}` : "",
      "",
      "This is private. I'll DM you if I find a compatible match.",
      "Use `/lfg manage` to edit or stop looking."
    ]
      .filter(Boolean)
      .join("\n"),
    components: []
  });
}

async function startLookFlow(interaction) {
  const events = await listOpenLfgEvents(interaction.guild);

  if (!events.length) {
    return replyOrUpdate(interaction, {
      content:
        "There are no upcoming events with LFG enabled right now.\nA moderator can turn LFG on with `/lfg setup`.",
      components: []
    });
  }

  setFlow(interaction.user.id, {
    guildId: interaction.guild.id,
    step: "event"
  });

  return replyOrUpdate(interaction, {
    content: "Choose an upcoming event to look for a team:",
    components: [eventSelectRow(events)]
  });
}

async function showManage(interaction) {
  const requests = await listActiveRequestsForUser(
    interaction.user.id,
    interaction.guild.id
  );

  if (!requests.length) {
    return replyOrUpdate(interaction, {
      content:
        "You don't have any active LFG requests.\nUse `/lfg look` to start looking for a team.",
      components: []
    });
  }

  const events = await listLfgEvents({ guildId: interaction.guild.id });
  const eventById = new Map(
    events.map(event => [event.discordEventId, event])
  );
  const lines = ["## Your Active LFG Requests", ""];

  for (const request of requests) {
    const event = eventById.get(request.eventId);
    const name = event?.eventName || "Event";
    const teamSize = event?.teamSize || request.memberUserIds.length;

    lines.push(
      `### ${name}`,
      `Status: ${requestStatusLine(request, teamSize)}`,
      ""
    );
  }

  return replyOrUpdate(interaction, {
    content: lines.join("\n").trim(),
    components: manageRows(requests, eventById)
  });
}

async function handleSetup(interaction) {
  if (!userIsStaff(interaction.member)) {
    return interaction.editReply("This command is staff-only.");
  }

  const eventInput = interaction.options.getString("event", true);
  const format = interaction.options.getString("format", true);
  const tierRuleId = resolveRulesetId(
    interaction.options.getString("tier_rules")
  );
  const ruleset = getTierRuleset(tierRuleId);
  const teamSize = teamSizeFromFormat(format);
  const scheduled = await resolveScheduledEvent(interaction.guild, eventInput);

  if (!scheduled) {
    return interaction.editReply(
      "I couldn't find that Discord Scheduled Event."
    );
  }

  const config = await upsertLfgEvent({
    discordEventId: scheduled.id,
    eventName: scheduled.name,
    guildId: interaction.guild.id,
    format,
    teamSize,
    tierRuleId,
    lfgEnabled: true,
    startTime: scheduled.scheduledStartAt?.toISOString?.() || "",
    createdBy: interaction.user.id
  });

  return interaction.editReply(
    [
      `✅ LFG enabled for **${config.eventName}**.`,
      `Format: ${formatLabel(format)} (${teamSize} players)`,
      `Tier rules: ${ruleset?.name || tierRuleId}`,
      scheduled.scheduledStartAt
        ? `Starts: ${shortWhenLabel(scheduled.scheduledStartAt)}`
        : "",
      "",
      "Players can now use `/lfg look` for this event."
    ]
      .filter(Boolean)
      .join("\n")
  );
}

async function handleDisable(interaction) {
  if (!userIsStaff(interaction.member)) {
    return interaction.editReply("This command is staff-only.");
  }

  const eventId = interaction.options.getString("event", true);
  const config = await getLfgEvent(eventId);

  if (!config) {
    return interaction.editReply("That event is not configured for LFG.");
  }

  await expireLfgEvent(interaction.client, config, "disabled");

  return interaction.editReply(
    `✅ LFG disabled for **${config.eventName}**. Active requests have been closed.`
  );
}

function newestPost(events) {
  return [...events].sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
  )[0];
}

async function resolvePostToEnd(interaction) {
  const eventId = interaction.options.getString("event");

  if (eventId) {
    return getLfgEvent(eventId);
  }

  const configs = await listLfgEvents({ guildId: interaction.guild.id });
  const openPosts = configs.filter(isLfgPostOpen);
  const inChannel = openPosts.filter(
    event => event.lfgChannelId === interaction.channelId
  );

  if (inChannel.length) {
    return newestPost(inChannel);
  }

  if (openPosts.length === 1) {
    return openPosts[0];
  }

  return null;
}

async function handleEnd(interaction) {
  if (!userIsStaff(interaction.member)) {
    return interaction.editReply("This command is staff-only.");
  }

  const config = await resolvePostToEnd(interaction);

  if (!config) {
    return interaction.editReply(
      "I couldn't find an active `/lfgpost` to end. Run this in the channel with the post, or pass the event."
    );
  }

  if (!isLfgPostOpen(config)) {
    return interaction.editReply(
      `There is no active \`/lfgpost\` for **${config.eventName}**.`
    );
  }

  const closed = await endLfgPost(interaction.client, config, "ended");

  return interaction.editReply(
    [
      `✅ Ended the LFG post for **${config.eventName}**.`,
      "Fill/need matching DMs have been stopped.",
      closed.length
        ? `Closed ${closed.length} open fill/need registration${closed.length === 1 ? "" : "s"}.`
        : ""
    ]
      .filter(Boolean)
      .join("\n")
  );
}

async function handleAdmin(interaction) {
  if (!userIsStaff(interaction.member)) {
    return interaction.editReply("This command is staff-only.");
  }

  const configs = await listLfgEvents({ guildId: interaction.guild.id });
  const discordEvents = await fetchGuildScheduledEvents(interaction.guild);
  const byId = new Map(discordEvents.map(event => [event.id, event]));

  if (!configs.length) {
    return interaction.editReply("No LFG events are configured.");
  }

  const blocks = [];

  for (const config of configs.sort((a, b) =>
    String(a.startTime).localeCompare(String(b.startTime))
  )) {
    const discordEvent = byId.get(config.discordEventId);
    const ruleset = getTierRuleset(config.tierRuleId);
    const stats = await countMatchStats(interaction.guild, config);
    const when = discordEvent?.scheduledStartAt
      ? shortWhenLabel(discordEvent.scheduledStartAt)
      : config.startTime
        ? shortWhenLabel(new Date(config.startTime))
        : "Time TBD";

    blocks.push(
      [
        `**${config.eventName}**`,
        `When: ${when}`,
        `Format: ${formatLabel(config.format)}`,
        `Tier Rules: ${ruleset?.name || config.tierRuleId}`,
        `LFG: ${config.lfgEnabled ? "Enabled" : "Disabled"}`,
        `Active requests: ${stats.activeCount}`,
        `Possible complete matches: ${stats.completeMatchCount}`,
        `Unmatched players: ${stats.unmatchedCount}`,
        `Partial teams: ${stats.partialTeamCount}`
      ].join("\n")
    );
  }

  const content = blocks.join("\n\n");

  if (content.length <= 1900) {
    return interaction.editReply(content);
  }

  return interaction.editReply(content.slice(0, 1900) + "\n…");
}

const tierChoices = listTierRulesets().map(ruleset => ({
  name: ruleset.name,
  value: ruleset.id
}));

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lfg")
    .setDescription("Private ZBD event matchmaking")
    .addSubcommand(sub =>
      sub
        .setName("look")
        .setDescription("Look for a team for an upcoming LFG event")
    )
    .addSubcommand(sub =>
      sub
        .setName("manage")
        .setDescription("View or stop your active LFG requests")
    )
    .addSubcommand(sub =>
      sub
        .setName("setup")
        .setDescription("Staff: enable LFG for a Discord Scheduled Event")
        .addStringOption(option =>
          option
            .setName("event")
            .setDescription("Upcoming Discord Scheduled Event")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName("format")
            .setDescription("Team format")
            .setRequired(true)
            .addChoices(
              { name: "Duos", value: "duos" },
              { name: "Trios", value: "trios" },
              { name: "Squads", value: "squads" }
            )
        )
        .addStringOption(option => {
          option
            .setName("tier_rules")
            .setDescription("Tier restriction ruleset")
            .setRequired(true);

          for (const choice of tierChoices.slice(0, 25)) {
            option.addChoices(choice);
          }

          return option;
        })
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Staff: turn LFG off for a configured event")
        .addStringOption(option =>
          option
            .setName("event")
            .setDescription("Configured LFG event")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("end")
        .setDescription("Staff: end the current /lfgpost search and stop fill DMs")
        .addStringOption(option =>
          option
            .setName("event")
            .setDescription("LFG post to end (defaults to this channel)")
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName("admin").setDescription("Staff: LFG overview")
    ),

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand(false);
    const focused = interaction.options.getFocused(true);

    if (sub === "setup" && focused?.name === "event") {
      await respondScheduledEventAutocomplete(interaction, focused.value);
      return;
    }

    if (
      (sub === "disable" || sub === "end") &&
      focused?.name === "event"
    ) {
      const configs = await listLfgEvents({
        guildId: interaction.guildId,
        enabledOnly: sub === "disable"
      });
      const query = String(focused.value || "").toLowerCase();
      const choices = configs
        .filter(event => {
          if (sub === "end" && !isLfgPostOpen(event)) {
            return false;
          }

          return !query || event.eventName.toLowerCase().includes(query);
        })
        .slice(0, 25)
        .map(event => ({
          name: event.eventName.slice(0, 100),
          value: event.discordEventId
        }));

      if (!interaction.responded) {
        await interaction.respond(choices);
      }
    }
  },

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: "Use this command in the ZBD server.",
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "look" || sub === "manage") {
      await interaction.deferReply({ ephemeral: true });

      if (sub === "look") {
        return startLookFlow(interaction);
      }

      return showManage(interaction);
    }

    await interaction.deferReply({ ephemeral: true });

    if (sub === "setup") {
      return handleSetup(interaction);
    }

    if (sub === "disable") {
      return handleDisable(interaction);
    }

    if (sub === "end") {
      return handleEnd(interaction);
    }

    if (sub === "admin") {
      return handleAdmin(interaction);
    }
  },

  async handleSelectMenu(interaction) {
    if (!isLfgCustomId(interaction.customId)) {
      return false;
    }

    if (interaction.customId === CUSTOM.PLAYER_EVENT) {
      const eventId = interaction.values[0];
      const eventConfig = await requireOpenEvent(interaction.guild, eventId);

      if (!eventConfig) {
        await interaction.update({
          content: "That event is no longer available for LFG.",
          components: []
        });
        return true;
      }

      setFlow(interaction.user.id, {
        guildId: interaction.guild.id,
        eventId,
        step: "type"
      });

      await interaction.update({
        content: typePrompt(eventConfig),
        components: typeButtonRows()
      });
      return true;
    }

    if (interaction.customId === CUSTOM.PLAYER_MATES) {
      const flow = getFlow(interaction.user.id);

      if (!flow?.eventId) {
        await interaction.update({
          content: "That LFG setup expired. Run `/lfg look` again.",
          components: []
        });
        return true;
      }

      const eventConfig = await requireOpenEvent(interaction.guild, flow.eventId);

      if (!eventConfig) {
        clearFlow(interaction.user.id);
        await interaction.update({
          content: "That event is no longer available for LFG.",
          components: []
        });
        return true;
      }

      const selected = interaction.users
        ? [...interaction.users.keys()]
        : interaction.values;

      if (selected.includes(interaction.user.id)) {
        await interaction.reply({
          content: "Don't select yourself — you're already on the team.",
          ephemeral: true
        });
        return true;
      }

      const validation = await validateRequestMembers(
        interaction.guild,
        [interaction.user.id, ...selected],
        eventConfig
      );

      if (!validation.ok) {
        await interaction.reply({
          content: validation.message,
          ephemeral: true
        });
        return true;
      }

      setFlow(interaction.user.id, {
        ...flow,
        teammateIds: selected,
        step: "note"
      });

      await interaction.update({
        content: [
          `**${eventConfig.eventName}**`,
          `Team so far: you + ${selected.map(id => `<@${id}>`).join(", ")}`,
          "",
          "Add an optional short note, or skip."
        ].join("\n"),
        components: notePromptRows()
      });
      return true;
    }

    return false;
  },

  async handleButton(interaction) {
    if (!isLfgCustomId(interaction.customId)) {
      return false;
    }

    const customId = interaction.customId;

    if (customId.startsWith(CUSTOM.PLAYER_TYPE_PREFIX)) {
      const type = customId.slice(CUSTOM.PLAYER_TYPE_PREFIX.length);
      const flow = getFlow(interaction.user.id);

      if (!flow?.eventId) {
        await interaction.update({
          content: "That LFG setup expired. Run `/lfg look` again.",
          components: []
        });
        return true;
      }

      const eventConfig = await requireOpenEvent(interaction.guild, flow.eventId);

      if (!eventConfig) {
        clearFlow(interaction.user.id);
        await interaction.update({
          content: "That event is no longer available for LFG.",
          components: []
        });
        return true;
      }

      if (type === "needs_players") {
        const allowed = maxTeammates(eventConfig.teamSize);

        if (allowed < 1) {
          await interaction.update({
            content:
              `A ${formatLabel(eventConfig.format)} team is only ${eventConfig.teamSize} players. ` +
              "If you already have a teammate, your team is full.\n" +
              "Choose **I need a team** or **I can fill** instead.",
            components: typeButtonRows()
          });
          return true;
        }

        setFlow(interaction.user.id, {
          ...flow,
          type,
          step: "teammates"
        });

        await interaction.update({
          content: [
            `**${eventConfig.eventName}**`,
            `Select your current teammate${allowed === 1 ? "" : "s"}.`,
            `You can add at most ${allowed} — a full team cannot use LFG.`
          ].join("\n"),
          components: [teammateSelectRow(allowed)]
        });
        return true;
      }

      setFlow(interaction.user.id, {
        ...flow,
        type,
        teammateIds: [],
        step: "note"
      });

      await interaction.update({
        content: [
          `**${eventConfig.eventName}**`,
          type === "can_fill"
            ? "You're marked as happy to fill an existing team."
            : "You're looking for a full team.",
          "",
          "Add an optional short note, or skip."
        ].join("\n"),
        components: notePromptRows()
      });
      return true;
    }

    if (customId === CUSTOM.PLAYER_NOTE) {
      if (!getFlow(interaction.user.id)?.eventId) {
        await interaction.reply({
          content: "That LFG setup expired. Run `/lfg look` again.",
          ephemeral: true
        });
        return true;
      }

      await interaction.showModal(noteModal());
      return true;
    }

    if (customId === CUSTOM.PLAYER_SKIP_NOTE) {
      const flow = getFlow(interaction.user.id);

      if (!flow?.eventId || !flow.type) {
        await interaction.update({
          content: "That LFG setup expired. Run `/lfg look` again.",
          components: []
        });
        return true;
      }

      await interaction.deferUpdate();
      await submitRequest(interaction, flow, "");
      return true;
    }

    if (customId.startsWith(CUSTOM.MANAGE_EDIT_PREFIX)) {
      const requestId = customId.slice(CUSTOM.MANAGE_EDIT_PREFIX.length);
      const request = await getLfgRequest(requestId);

      if (!request || request.ownerUserId !== interaction.user.id) {
        await interaction.reply({
          content: "I couldn't find that LFG request.",
          ephemeral: true
        });
        return true;
      }

      const eventConfig = await requireOpenEvent(
        interaction.guild,
        request.eventId
      );

      if (!eventConfig) {
        await interaction.update({
          content: "That event is no longer available for LFG.",
          components: []
        });
        return true;
      }

      setFlow(interaction.user.id, {
        guildId: interaction.guild.id,
        eventId: request.eventId,
        step: "type"
      });

      await interaction.update({
        content: typePrompt(eventConfig),
        components: typeButtonRows()
      });
      return true;
    }

    if (customId.startsWith(CUSTOM.MANAGE_STOP_PREFIX)) {
      const requestId = customId.slice(CUSTOM.MANAGE_STOP_PREFIX.length);
      const request = await getLfgRequest(requestId);

      if (!request || request.ownerUserId !== interaction.user.id) {
        await interaction.reply({
          content: "I couldn't find that LFG request.",
          ephemeral: true
        });
        return true;
      }

      const event = await getLfgEvent(request.eventId);
      await stopLooking(
        interaction.client,
        request,
        event?.eventName || "this event"
      );

      if (event) {
        recalculateMatches(interaction.guild, event).catch(() => {});
      }

      await interaction.update({
        content: `✅ You're no longer looking for a team for **${event?.eventName || "that event"}**.`,
        components: []
      });
      return true;
    }

    if (customId.startsWith(CUSTOM.MATCH_YES_PREFIX)) {
      const matchId = customId.slice(CUSTOM.MATCH_YES_PREFIX.length);
      const match = await getLfgMatch(matchId);
      const event = match ? await getLfgEvent(match.eventId) : null;
      const guild = await resolveGuild(interaction, event?.guildId);

      if (!match || !event || !guild) {
        await interaction.update({
          content: "That match is no longer available.",
          components: []
        });
        return true;
      }

      const result = await recordInterest(
        guild,
        event,
        matchId,
        interaction.user.id
      );

      await interaction.update({
        content: result.ok
          ? result.matched
            ? `✅ It's a match for **${event.eventName}**! Check your DMs.`
            : `✅ Interest recorded for **${event.eventName}**. We'll let the other players know.`
          : result.message,
        components: []
      });
      return true;
    }

    if (customId.startsWith(CUSTOM.MATCH_NO_PREFIX)) {
      const matchId = customId.slice(CUSTOM.MATCH_NO_PREFIX.length);
      const match = await getLfgMatch(matchId);
      const event = match ? await getLfgEvent(match.eventId) : null;
      const guild = await resolveGuild(interaction, event?.guildId);

      await dismissMatch(
        guild,
        event,
        matchId,
        interaction.user.id
      );

      await interaction.update({
        content:
          "Okay — I won't show you that exact match again. You're still looking, and I'll keep matching you with other players.",
        components: []
      });
      return true;
    }

    if (customId.startsWith(CUSTOM.MATCH_STOP_PREFIX)) {
      const requestId = customId.slice(CUSTOM.MATCH_STOP_PREFIX.length);
      const request = await getLfgRequest(requestId);

      if (!request || request.ownerUserId !== interaction.user.id) {
        await interaction.update({
          content: "I couldn't find that LFG request.",
          components: []
        });
        return true;
      }

      const event = await getLfgEvent(request.eventId);
      await stopLooking(
        interaction.client,
        request,
        event?.eventName || "this event"
      );

      const guild = await resolveGuild(interaction, event?.guildId);

      if (event && guild) {
        recalculateMatches(guild, event).catch(() => {});
      }

      await interaction.update({
        content: `✅ You're no longer looking for a team for **${event?.eventName || "that event"}**.`,
        components: []
      });
      return true;
    }

    return false;
  },

  async handleModalSubmit(interaction) {
    if (interaction.customId !== CUSTOM.PLAYER_MODAL) {
      return false;
    }

    const flow = getFlow(interaction.user.id);

    if (!flow?.eventId || !flow.type) {
      await interaction.reply({
        content: "That LFG setup expired. Run `/lfg look` again.",
        ephemeral: true
      });
      return true;
    }

    const note = interaction.fields.getTextInputValue("note")?.trim() || "";
    await interaction.deferReply({ ephemeral: true });
    await submitRequest(interaction, flow, note);
    return true;
  }
};
