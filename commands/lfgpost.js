const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { userIsStaff } = require("../lib/staffPermissions");

const {
  fetchGuildScheduledEvents,
  getSelectableScheduledEvents,
  resolveScheduledEvent
} = require("../lib/guildScheduledEvents");

const {
  teamSizeFromFormat,
  formatLabel
} = require("../lib/genderRestrictions");

const { DEFAULT_TIER_RULESET_ID } = require("../lib/tierRestrictions");

const {
  upsertLfgEvent,
  getLfgEvent,
  createLfgRequest,
  updateLfgRequest,
  getLfgRequest,
  getActivePostRequest,
  closeLfgRequest,
  POST_FILL_TYPE,
  POST_NEED_TYPE,
  isLfgPostOpen
} = require("../lib/lfgSheet");

const {
  readPlayerProfile,
  formatProfileIssue
} = require("../lib/lfgEligibility");

const { shortWhenLabel } = require("../lib/lfgExpiry");

const {
  matchFillAgainstOpenNeeds,
  matchNeedAgainstOpenFills,
  sendPostDm,
  memberHasExcludeRole
} = require("../lib/lfgPostMatching");

const {
  POST_CUSTOM,
  POST_GENDER_LABEL,
  isLfgPostCustomId,
  publicPostContent,
  publicPostRows,
  staffEventSelectRow,
  staffModeSelectRow,
  staffRoleSelectRow,
  staffEveryoneSelectRow,
  fillManageRows,
  needManageRows,
  needFlowRows,
  formatNeedSummary,
  requiredGenderFromSelection,
  discordTimestamp
} = require("../lib/lfgPostUi");

const FLOW_TTL_MS = 10 * 60 * 1000;
const staffFlows = new Map();
const needFlows = new Map();

function setMapFlow(map, key, data) {
  map.set(key, {
    ...data,
    expiresAt: Date.now() + FLOW_TTL_MS
  });
}

function getMapFlow(map, key) {
  const flow = map.get(key);

  if (!flow || flow.expiresAt < Date.now()) {
    map.delete(key);
    return null;
  }

  return flow;
}

function displayName(interaction) {
  return (
    interaction.member?.displayName ||
    interaction.user.globalName ||
    interaction.user.username
  );
}

function eventStartIso(scheduled) {
  return scheduled?.scheduledStartAt?.toISOString?.() || "";
}

function eventIdFromPrefix(customId, prefix) {
  if (!customId.startsWith(prefix)) {
    return "";
  }

  return customId.slice(prefix.length);
}

async function loadUpcomingEvents(guild) {
  const events = getSelectableScheduledEvents(
    await fetchGuildScheduledEvents(guild),
    { preferNearTerm: false }
  );
  const now = Date.now();

  return events
    .filter(
      event =>
        !event.scheduledStartAt || event.scheduledStartAt.getTime() > now
    )
    .map(event => ({
      ...event,
      whenLabel: shortWhenLabel(event.scheduledStartAt)
    }));
}

async function resolveCommandChannel(guild, interaction, channelId) {
  const fromInteraction = interaction.channel;

  if (fromInteraction?.isTextBased?.() && !fromInteraction.isDMBased?.()) {
    return fromInteraction;
  }

  const id = channelId || interaction.channelId;

  if (!id) {
    return null;
  }

  const fetched =
    guild.channels.cache.get(id) ||
    (await guild.channels.fetch(id).catch(() => null));

  if (fetched?.isTextBased?.() && !fetched.isDMBased?.()) {
    return fetched;
  }

  return null;
}

async function postPublicLfgMessage(guild, eventConfig, scheduled, channel) {
  if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
    return {
      ok: false,
      message: "Use `/lfgpost` in the channel where you want the LFG post to appear."
    };
  }

  if (eventConfig.lfgChannelId && eventConfig.lfgMessageId) {
    try {
      const previousChannel =
        guild.channels.cache.get(eventConfig.lfgChannelId) ||
        (await guild.channels.fetch(eventConfig.lfgChannelId).catch(() => null));
      const previous = await previousChannel?.messages
        ?.fetch(eventConfig.lfgMessageId)
        .catch(() => null);

      if (previous) {
        await previous.delete().catch(() => {});
      }
    } catch {
      // Keep going — posting a fresh message is more important.
    }
  }

  const mentionEveryone = Boolean(eventConfig.mentionEveryone);

  const posted = await channel.send({
    content: publicPostContent(scheduled.name, scheduled.scheduledStartAt, {
      mentionEveryone
    }),
    components: publicPostRows(scheduled.id),
    allowedMentions: mentionEveryone ? { parse: ["everyone"] } : { parse: [] }
  });

  const saved = await upsertLfgEvent({
    discordEventId: scheduled.id,
    eventName: scheduled.name,
    guildId: guild.id,
    format: eventConfig.format,
    teamSize: eventConfig.teamSize,
    tierRuleId: eventConfig.tierRuleId,
    lfgEnabled: true,
    startTime: eventStartIso(scheduled),
    lfgChannelId: channel.id,
    lfgMessageId: posted.id,
    excludeRoleId: eventConfig.excludeRoleId,
    mentionEveryone: Boolean(eventConfig.mentionEveryone),
    lfgPostEnabled: true,
    createdBy: eventConfig.createdBy
  });

  return { ok: true, message: posted, event: saved, channel };
}

async function handleStaffCommand(interaction) {
  if (!userIsStaff(interaction.member)) {
    return interaction.editReply(
      "This command is staff-only. Players use the buttons on the LFG post."
    );
  }

  const events = await loadUpcomingEvents(interaction.guild);

  if (!events.length) {
    return interaction.editReply(
      "There are no upcoming Discord Scheduled Events to post LFG for."
    );
  }

  setMapFlow(staffFlows, interaction.user.id, {
    guildId: interaction.guild.id,
    channelId: interaction.channelId,
    step: "event"
  });

  return interaction.editReply({
    content: "Choose the Discord Scheduled Event to post LFG for:",
    components: [staffEventSelectRow(events)]
  });
}

async function registerFill(interaction, eventId) {
  const guild = interaction.guild;
  const eventConfig = await getLfgEvent(eventId);

  if (!isLfgPostOpen(eventConfig)) {
    return interaction.editReply({
      content: "That LFG post is no longer open.",
      components: []
    });
  }

  const member =
    interaction.member ||
    (await guild.members.fetch(interaction.user.id).catch(() => null));

  if (memberHasExcludeRole(member, eventConfig)) {
    const existingExcluded = await getActivePostRequest(
      eventId,
      interaction.user.id,
      POST_FILL_TYPE
    );

    if (existingExcluded) {
      await closeLfgRequest(existingExcluded.id, "has_event_role");
    }

    return interaction.editReply({
      content:
        "You already have the event role, so you can't register as looking to join / fill.",
      components: []
    });
  }

  const existing = await getActivePostRequest(
    eventId,
    interaction.user.id,
    POST_FILL_TYPE
  );

  if (existing) {
    return interaction.editReply({
      content:
        "You're already registered as looking to fill for this event.\nUse the button below if you're no longer available.",
      components: fillManageRows(existing.id)
    });
  }

  const profile = await readPlayerProfile(guild, interaction.user.id);

  if (!profile.ok) {
    return interaction.editReply({
      content: `I couldn't register you as looking to fill.\n${formatProfileIssue(profile)}`,
      components: []
    });
  }

  const request = await createLfgRequest({
    eventId,
    guildId: guild.id,
    ownerUserId: interaction.user.id,
    type: POST_FILL_TYPE,
    memberUserIds: [interaction.user.id],
    source: "lfgpost",
    username: displayName(interaction),
    loggedTier: profile.tier,
    loggedGender: profile.gender,
    status: "OPEN",
    active: true,
    dmOk: true,
    eventName: eventConfig.eventName,
    eventStart: eventConfig.startTime,
    format: eventConfig.format
  });

  matchFillAgainstOpenNeeds(guild, eventId, request).catch(err => {
    console.error("[LFGPOST] fill matching failed:", err?.message || err);
  });

  return interaction.editReply({
    content: [
      `✅ You're registered as looking to fill for **${eventConfig.eventName}**.`,
      "",
      `Logged as **${profile.tier} Tier ${POST_GENDER_LABEL[profile.gender] || profile.gender}** from your Discord roles.`,
      "",
      "If you find a team, tap **No Longer Available** so you stop showing up as a match."
    ].join("\n"),
    components: fillManageRows(request.id)
  });
}

async function startNeedFlow(interaction, eventId) {
  const eventConfig = await getLfgEvent(eventId);

  if (!isLfgPostOpen(eventConfig)) {
    return interaction.editReply({
      content: "That LFG post is no longer open.",
      components: []
    });
  }

  const profile = await readPlayerProfile(interaction.guild, interaction.user.id);

  if (!profile.ok) {
    return interaction.editReply({
      content: `I couldn't start a teammate request.\n${formatProfileIssue(profile)}`,
      components: []
    });
  }

  setMapFlow(needFlows, `${interaction.user.id}:${eventId}`, {
    eventId,
    guildId: interaction.guild.id,
    acceptedTiers: [],
    acceptedGenders: [],
    requiredGender: ""
  });

  return interaction.editReply({
    content: [
      `**${eventConfig.eventName}**`,
      `Mode: ${formatLabel(eventConfig.format)}`,
      "",
      "Select the tier(s) and gender(s) you need, then tap **Submit**.",
      "You can choose more than one tier — for example A + B + C.",
      "You can also select both Girl and Boy."
    ].join("\n"),
    components: needFlowRows(eventId)
  });
}

async function submitNeed(interaction, eventId, flow) {
  const guild = interaction.guild;
  const eventConfig = await getLfgEvent(eventId);

  if (!isLfgPostOpen(eventConfig)) {
    needFlows.delete(`${interaction.user.id}:${eventId}`);
    return interaction.editReply({
      content: "That LFG post is no longer open.",
      components: []
    });
  }

  const acceptedTiers = [...new Set(flow.acceptedTiers || [])];
  const requiredGender = requiredGenderFromSelection(
    flow.acceptedGenders?.length ? flow.acceptedGenders : [flow.requiredGender]
  );

  if (!acceptedTiers.length || !requiredGender) {
    return interaction.editReply({
      content: [
        `**${eventConfig.eventName}**`,
        "",
        "Select at least one tier and at least one gender, then tap **Submit**.",
        "You can select both Girl and Boy."
      ].join("\n"),
      components: needFlowRows(
        eventId,
        acceptedTiers,
        flow.acceptedGenders || []
      )
    });
  }

  const profile = await readPlayerProfile(guild, interaction.user.id);

  if (!profile.ok) {
    return interaction.editReply({
      content: `I couldn't create your teammate request.\n${formatProfileIssue(profile)}`,
      components: []
    });
  }

  const dmOk = await sendPostDm(interaction.client, interaction.user.id, {
    content: [
      `You're looking for a teammate for **${eventConfig.eventName}**.`,
      `Need: ${formatNeedSummary(acceptedTiers, requiredGender)}`,
      "",
      "I'll DM you when someone who fits becomes available."
    ].join("\n")
  });

  if (!dmOk) {
    return interaction.editReply({
      content: [
        "⚠️ I couldn't send you a DM.",
        "",
        "Enable DMs from server members so I can notify you when a matching player registers."
      ].join("\n"),
      components: []
    });
  }

  const existing = await getActivePostRequest(
    eventId,
    interaction.user.id,
    POST_NEED_TYPE
  );

  let request;

  if (existing) {
    request = await updateLfgRequest(existing.id, {
      acceptedTiers,
      requiredGender,
      username: displayName(interaction),
      loggedTier: profile.tier,
      loggedGender: profile.gender,
      status: "OPEN",
      active: true,
      dmOk: true,
      eventName: eventConfig.eventName,
      eventStart: eventConfig.startTime,
      format: eventConfig.format
    });
  } else {
    request = await createLfgRequest({
      eventId,
      guildId: guild.id,
      ownerUserId: interaction.user.id,
      type: POST_NEED_TYPE,
      memberUserIds: [interaction.user.id],
      source: "lfgpost",
      username: displayName(interaction),
      loggedTier: profile.tier,
      loggedGender: profile.gender,
      acceptedTiers,
      requiredGender,
      status: "OPEN",
      active: true,
      dmOk: true,
      eventName: eventConfig.eventName,
      eventStart: eventConfig.startTime,
      format: eventConfig.format
    });
  }

  needFlows.delete(`${interaction.user.id}:${eventId}`);

  matchNeedAgainstOpenFills(guild, eventId, request).catch(err => {
    console.error("[LFGPOST] need matching failed:", err?.message || err);
  });

  return interaction.editReply({
    content: [
      `✅ Teammate request submitted for **${eventConfig.eventName}**.`,
      "",
      `Looking for: **${formatNeedSummary(acceptedTiers, requiredGender)}**`,
      `Event time: ${discordTimestamp(eventConfig.startTime)}`,
      "",
      "I'll DM you if someone who fits is already available, or when they register later.",
      "Tap **Found Teammate / Stop Looking** when you no longer need a match."
    ].join("\n"),
    components: needManageRows(request.id)
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lfgpost")
    .setDescription("Staff: post public event LFG in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: "Use this command in the channel where you want the LFG post.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });
    return handleStaffCommand(interaction);
  },

  async handleSelectMenu(interaction) {
    if (!isLfgPostCustomId(interaction.customId)) {
      return false;
    }

    if (interaction.customId === POST_CUSTOM.STAFF_EVENT) {
      if (!userIsStaff(interaction.member)) {
        await interaction.reply({
          content: "This setup step is staff-only.",
          ephemeral: true
        });
        return true;
      }

      const eventId = interaction.values[0];
      const scheduled = await resolveScheduledEvent(interaction.guild, eventId);

      if (!scheduled) {
        await interaction.update({
          content: "I couldn't find that Discord Scheduled Event.",
          components: []
        });
        return true;
      }

      const existingFlow = getMapFlow(staffFlows, interaction.user.id);

      setMapFlow(staffFlows, interaction.user.id, {
        guildId: interaction.guild.id,
        channelId: existingFlow?.channelId || interaction.channelId,
        eventId: scheduled.id,
        eventName: scheduled.name,
        startTime: eventStartIso(scheduled),
        step: "mode"
      });

      await interaction.update({
        content: [
          `**${scheduled.name}**`,
          `Starts: ${discordTimestamp(scheduled.scheduledStartAt)}`,
          "",
          "Choose Duos, Trios, or Squads."
        ].join("\n"),
        components: [staffModeSelectRow()]
      });
      return true;
    }

    if (interaction.customId === POST_CUSTOM.STAFF_MODE) {
      if (!userIsStaff(interaction.member)) {
        await interaction.reply({
          content: "This setup step is staff-only.",
          ephemeral: true
        });
        return true;
      }

      const flow = getMapFlow(staffFlows, interaction.user.id);

      if (!flow?.eventId) {
        await interaction.update({
          content: "That `/lfgpost` setup expired. Run `/lfgpost` again.",
          components: []
        });
        return true;
      }

      const format = interaction.values[0];
      const teamSize = teamSizeFromFormat(format);
      const scheduled = await resolveScheduledEvent(
        interaction.guild,
        flow.eventId
      );

      if (!scheduled) {
        staffFlows.delete(interaction.user.id);
        await interaction.update({
          content: "I couldn't find that Discord Scheduled Event.",
          components: []
        });
        return true;
      }

      setMapFlow(staffFlows, interaction.user.id, {
        ...flow,
        format,
        teamSize,
        step: "role"
      });

      await interaction.update({
        content: [
          `**${scheduled.name}**`,
          `Mode: ${formatLabel(format)}`,
          `Starts: ${discordTimestamp(scheduled.scheduledStartAt)}`,
          "",
          "Choose the event signup role.",
          "Players who already have this role cannot register as looking to join / fill, and will be removed from that list if they get the role later."
        ].join("\n"),
        components: [staffRoleSelectRow()]
      });
      return true;
    }

    if (interaction.customId === POST_CUSTOM.STAFF_ROLE) {
      if (!userIsStaff(interaction.member)) {
        await interaction.reply({
          content: "This setup step is staff-only.",
          ephemeral: true
        });
        return true;
      }

      const flow = getMapFlow(staffFlows, interaction.user.id);

      if (!flow?.eventId || !flow.format) {
        await interaction.update({
          content: "That `/lfgpost` setup expired. Run `/lfgpost` again.",
          components: []
        });
        return true;
      }

      const excludeRoleId = interaction.values[0];
      const scheduled = await resolveScheduledEvent(
        interaction.guild,
        flow.eventId
      );

      if (!scheduled) {
        staffFlows.delete(interaction.user.id);
        await interaction.update({
          content: "I couldn't find that Discord Scheduled Event.",
          components: []
        });
        return true;
      }

      setMapFlow(staffFlows, interaction.user.id, {
        ...flow,
        excludeRoleId,
        step: "everyone"
      });

      await interaction.update({
        content: [
          `**${scheduled.name}**`,
          `Mode: ${formatLabel(flow.format)}`,
          `Signup role: <@&${excludeRoleId}>`,
          `Starts: ${discordTimestamp(scheduled.scheduledStartAt)}`,
          "",
          "Tag @everyone on this post?"
        ].join("\n"),
        components: [staffEveryoneSelectRow()]
      });
      return true;
    }

    if (interaction.customId === POST_CUSTOM.STAFF_EVERYONE) {
      if (!userIsStaff(interaction.member)) {
        await interaction.reply({
          content: "This setup step is staff-only.",
          ephemeral: true
        });
        return true;
      }

      const flow = getMapFlow(staffFlows, interaction.user.id);

      if (!flow?.eventId || !flow.format || !flow.excludeRoleId) {
        await interaction.update({
          content: "That `/lfgpost` setup expired. Run `/lfgpost` again.",
          components: []
        });
        return true;
      }

      const mentionEveryone = interaction.values[0] === "true";
      const excludeRoleId = flow.excludeRoleId;
      const format = flow.format;
      const teamSize = flow.teamSize || teamSizeFromFormat(format);
      const scheduled = await resolveScheduledEvent(
        interaction.guild,
        flow.eventId
      );

      if (!scheduled) {
        staffFlows.delete(interaction.user.id);
        await interaction.update({
          content: "I couldn't find that Discord Scheduled Event.",
          components: []
        });
        return true;
      }

      await interaction.deferUpdate();

      const existing = await getLfgEvent(scheduled.id);
      const eventConfig = await upsertLfgEvent({
        discordEventId: scheduled.id,
        eventName: scheduled.name,
        guildId: interaction.guild.id,
        format,
        teamSize,
        tierRuleId: existing?.tierRuleId || DEFAULT_TIER_RULESET_ID,
        lfgEnabled: true,
        startTime: eventStartIso(scheduled),
        excludeRoleId,
        mentionEveryone,
        lfgPostEnabled: true,
        createdBy: existing?.createdBy || interaction.user.id
      });

      let posted;

      try {
        const channel = await resolveCommandChannel(
          interaction.guild,
          interaction,
          flow.channelId
        );
        posted = await postPublicLfgMessage(
          interaction.guild,
          eventConfig,
          scheduled,
          channel
        );
      } catch (err) {
        staffFlows.delete(interaction.user.id);
        await interaction.editReply({
          content: `I couldn't post to the LFG channel: ${err?.message || err}`,
          components: []
        });
        return true;
      }

      staffFlows.delete(interaction.user.id);

      if (!posted.ok) {
        await interaction.editReply({
          content: posted.message,
          components: []
        });
        return true;
      }

      await interaction.editReply({
        content: [
          `✅ LFG post created for **${scheduled.name}**.`,
          `Mode: ${formatLabel(format)} (${teamSize} players)`,
          `Signup role: <@&${excludeRoleId}>`,
          `Tag @everyone: ${mentionEveryone ? "True" : "False"}`,
          `Starts: ${discordTimestamp(scheduled.scheduledStartAt)}`,
          `Posted in <#${posted.channel.id}>`
        ].join("\n"),
        components: []
      });
      return true;
    }

    if (interaction.customId.startsWith(POST_CUSTOM.NEED_TIERS_PREFIX)) {
      const eventId = eventIdFromPrefix(
        interaction.customId,
        POST_CUSTOM.NEED_TIERS_PREFIX
      );
      const key = `${interaction.user.id}:${eventId}`;
      const flow = getMapFlow(needFlows, key) || {
        eventId,
        acceptedTiers: [],
        acceptedGenders: [],
        requiredGender: ""
      };

      setMapFlow(needFlows, key, {
        ...flow,
        eventId,
        acceptedTiers: interaction.values.map(value => value.toUpperCase())
      });

      await interaction.deferUpdate();
      return true;
    }

    if (interaction.customId.startsWith(POST_CUSTOM.NEED_GENDER_PREFIX)) {
      const eventId = eventIdFromPrefix(
        interaction.customId,
        POST_CUSTOM.NEED_GENDER_PREFIX
      );
      const key = `${interaction.user.id}:${eventId}`;
      const flow = getMapFlow(needFlows, key) || {
        eventId,
        acceptedTiers: [],
        acceptedGenders: [],
        requiredGender: ""
      };

      setMapFlow(needFlows, key, {
        ...flow,
        eventId,
        acceptedGenders: interaction.values.map(value => value.toLowerCase()),
        requiredGender: requiredGenderFromSelection(interaction.values)
      });

      await interaction.deferUpdate();
      return true;
    }

    return false;
  },

  async handleButton(interaction) {
    if (!isLfgPostCustomId(interaction.customId)) {
      return false;
    }

    const customId = interaction.customId;

    if (customId.startsWith(POST_CUSTOM.FILL_PREFIX)) {
      const eventId = eventIdFromPrefix(customId, POST_CUSTOM.FILL_PREFIX);
      await interaction.deferReply({ ephemeral: true });
      await registerFill(interaction, eventId);
      return true;
    }

    if (customId.startsWith(POST_CUSTOM.NEED_PREFIX)) {
      const eventId = eventIdFromPrefix(customId, POST_CUSTOM.NEED_PREFIX);
      await interaction.deferReply({ ephemeral: true });
      await startNeedFlow(interaction, eventId);
      return true;
    }

    if (customId.startsWith(POST_CUSTOM.NEED_SUBMIT_PREFIX)) {
      const eventId = eventIdFromPrefix(
        customId,
        POST_CUSTOM.NEED_SUBMIT_PREFIX
      );
      const flow = getMapFlow(needFlows, `${interaction.user.id}:${eventId}`);

      await interaction.deferUpdate();

      if (!flow?.eventId) {
        await interaction.editReply({
          content:
            "That teammate request expired. Press **I / We need a teammate** again.",
          components: []
        });
        return true;
      }

      await submitNeed(interaction, eventId, flow);
      return true;
    }

    if (customId.startsWith(POST_CUSTOM.FILL_STOP_PREFIX)) {
      const requestId = eventIdFromPrefix(
        customId,
        POST_CUSTOM.FILL_STOP_PREFIX
      );
      const request = await getLfgRequest(requestId);

      if (!request || request.ownerUserId !== interaction.user.id) {
        await interaction.reply({
          content: "I couldn't find that fill registration.",
          ephemeral: true
        });
        return true;
      }

      await closeLfgRequest(request.id, "no_longer_available");
      const event = await getLfgEvent(request.eventId);

      await interaction.update({
        content: `✅ You're no longer listed as available for **${event?.eventName || "that event"}**.`,
        components: []
      });
      return true;
    }

    if (customId.startsWith(POST_CUSTOM.NEED_STOP_PREFIX)) {
      const requestId = eventIdFromPrefix(
        customId,
        POST_CUSTOM.NEED_STOP_PREFIX
      );
      const request = await getLfgRequest(requestId);

      if (!request || request.ownerUserId !== interaction.user.id) {
        await interaction.reply({
          content: "I couldn't find that teammate request.",
          ephemeral: true
        });
        return true;
      }

      if (request.active) {
        await closeLfgRequest(request.id, "stop_notifying");
      }

      const event = await getLfgEvent(request.eventId);
      const eventName = event?.eventName || "that event";
      const stopped =
        `✅ Stopped notifying you for **${eventName}**. You won't get more fill DMs for this request.`;

      if (interaction.channel?.isDMBased?.()) {
        const previous = interaction.message?.content || "";
        const content = previous.includes("Stopped notifying you")
          ? previous
          : [previous, "", stopped].filter(Boolean).join("\n");

        await interaction.update({
          content,
          components: []
        });
        return true;
      }

      await interaction.update({
        content: `✅ You've stopped looking for a teammate for **${eventName}**.`,
        components: []
      });
      return true;
    }

    return false;
  }
};
