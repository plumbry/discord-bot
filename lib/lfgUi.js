const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const { formatLabel } = require("./genderRestrictions");

const CUSTOM = {
  PLAYER_EVENT: "lfg:p:event",
  PLAYER_TYPE_PREFIX: "lfg:p:type:",
  PLAYER_MATES: "lfg:p:mates",
  PLAYER_NOTE: "lfg:p:note",
  PLAYER_SKIP_NOTE: "lfg:p:skipnote",
  PLAYER_MODAL: "lfg:p:modal",
  MANAGE_EDIT_PREFIX: "lfg:g:edit:",
  MANAGE_STOP_PREFIX: "lfg:g:stop:",
  MATCH_YES_PREFIX: "lfg:m:yes:",
  MATCH_NO_PREFIX: "lfg:m:no:",
  MATCH_STOP_PREFIX: "lfg:m:stop:"
};

const TYPE_CHOICES = [
  {
    id: "needs_team",
    label: "I need a team",
    description: "You're currently solo"
  },
  {
    id: "needs_players",
    label: "My team needs players",
    description: "You already have teammate(s)"
  },
  {
    id: "can_fill",
    label: "I can fill",
    description: "You're happy to join a partial team"
  }
];

function isLfgCustomId(customId) {
  return typeof customId === "string" && customId.startsWith("lfg:");
}

function requestStatusLine(request, teamSize) {
  if (request.type === "can_fill") {
    return "Can fill";
  }

  if (request.type === "needs_players") {
    const have = request.memberUserIds.length;
    const need = Math.max(teamSize - have, 0);
    return `Team of ${have} — looking for ${need}`;
  }

  return "Looking for team";
}

function eventSelectRow(events) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(CUSTOM.PLAYER_EVENT)
      .setPlaceholder("Choose an event")
      .addOptions(
        events.slice(0, 25).map(event => ({
          label: event.eventName.slice(0, 100),
          value: event.discordEventId,
          description: `${formatLabel(event.format)} · ${event.whenLabel || "Upcoming"}`.slice(
            0,
            100
          )
        }))
      )
  );
}

function typeButtonRows() {
  const row = new ActionRowBuilder();

  for (const choice of TYPE_CHOICES) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM.PLAYER_TYPE_PREFIX}${choice.id}`)
        .setLabel(choice.label)
        .setStyle(ButtonStyle.Primary)
    );
  }

  return [row];
}

function teammateSelectRow(maxTeammates) {
  return new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(CUSTOM.PLAYER_MATES)
      .setPlaceholder("Select your current teammates")
      .setMinValues(1)
      .setMaxValues(Math.max(1, maxTeammates))
  );
}

function notePromptRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CUSTOM.PLAYER_NOTE)
        .setLabel("Add a short note")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(CUSTOM.PLAYER_SKIP_NOTE)
        .setLabel("Skip note")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function noteModal() {
  return new ModalBuilder()
    .setCustomId(CUSTOM.PLAYER_MODAL)
    .setTitle("Optional LFG note")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("note")
          .setLabel("Short note (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
          .setPlaceholder("first ZBD event, happy to IGL, prefer EU")
      )
    );
}

function manageRows(requests, eventById) {
  const rows = [];

  for (const request of requests.slice(0, 5)) {
    const event = eventById.get(request.eventId);
    const label = (event?.eventName || "Event").slice(0, 40);

    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM.MANAGE_EDIT_PREFIX}${request.id}`)
          .setLabel(`Edit ${label}`.slice(0, 80))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`${CUSTOM.MANAGE_STOP_PREFIX}${request.id}`)
          .setLabel("Stop Looking")
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

  return rows;
}

function matchActionRows(matchId, requestId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM.MATCH_YES_PREFIX}${matchId}`)
        .setLabel("I'm Interested")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM.MATCH_NO_PREFIX}${matchId}`)
        .setLabel("Not For Me")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM.MATCH_STOP_PREFIX}${requestId}`)
        .setLabel("Stop Looking")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function formatPlayerList(userIds, ownerUserId) {
  return userIds
    .map(userId =>
      userId === ownerUserId ? `<@${userId}> (you)` : `<@${userId}>`
    )
    .join("\n");
}

function possibleTeamDm({
  eventName,
  ownerUserId,
  userIds,
  addingUserIds,
  currentUserIds,
  noteByUserId
}) {
  const isFill = addingUserIds?.length && currentUserIds?.length;
  const lines = [];

  if (isFill) {
    lines.push(
      "## 💡 Possible player found!",
      "",
      addingUserIds.length === 1
        ? `<@${addingUserIds[0]}> may be a good fit for your **${eventName}** team.`
        : `These players may be a good fit for your **${eventName}** team.`
    );

    lines.push("", "**Your current team:**", formatPlayerList(currentUserIds, ownerUserId));
    lines.push(
      "",
      addingUserIds.length === 1 ? "**Possible addition:**" : "**Possible additions:**",
      formatPlayerList(addingUserIds, ownerUserId)
    );
  } else {
    lines.push(
      "## 💡 Possible team found!",
      "",
      `We found players you can team with for **${eventName}**.`,
      "",
      "**Possible team:**",
      formatPlayerList(userIds, ownerUserId)
    );
  }

  lines.push(
    "",
    "This combination fits the event's gender and tier restrictions."
  );

  const notes = [];

  for (const userId of userIds) {
    const note = noteByUserId.get(userId);

    if (note) {
      notes.push(`<@${userId}>: ${note}`);
    }
  }

  if (notes.length) {
    lines.push("", "**Notes:**", ...notes);
  }

  return lines.join("\n");
}

function interestedNotifyContent(interestedUserId, eventName) {
  return (
    `<@${interestedUserId}> is interested in your possible **${eventName}** match.\n\n` +
    "You can message them directly if you'd like to organise the team."
  );
}

function confirmedMatchContent(eventName, userIds) {
  return [
    "## ✅ It's a match!",
    "",
    "Both sides are interested.",
    "",
    "**Team:**",
    ...userIds.map(userId => `<@${userId}>`),
    "",
    `You can now message each other and organise your team for **${eventName}**.`,
    "",
    "This does not register the team — you still need to sign up as usual."
  ].join("\n");
}

function stoppedLookingContent(eventName) {
  return `✅ You're no longer looking for a team for **${eventName}**.`;
}

function dmProbeContent(eventName, statusLine) {
  return [
    `You're now looking for a team for **${eventName}**.`,
    "",
    `Status: ${statusLine}`,
    "",
    "I'll DM you if I find compatible players. This request is private — it is not posted in the LFG channel."
  ].join("\n");
}

function dmDisabledWarning() {
  return [
    "⚠️ I couldn't send you a DM.",
    "",
    "You'll need to enable DMs from server members to receive LFG matches."
  ].join("\n");
}

module.exports = {
  CUSTOM,
  TYPE_CHOICES,
  isLfgCustomId,
  requestStatusLine,
  eventSelectRow,
  typeButtonRows,
  teammateSelectRow,
  notePromptRows,
  noteModal,
  manageRows,
  matchActionRows,
  possibleTeamDm,
  interestedNotifyContent,
  confirmedMatchContent,
  stoppedLookingContent,
  dmProbeContent,
  dmDisabledWarning
};
