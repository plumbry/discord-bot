const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const { getSheets } = require("../lib/sheets");

const {
  getRows,
  getSignupBlockReason,
  formatSignupBlockMessage
} = require("../event-bans/eventBans");

const {
  formatInvalidTierSignupMessage,
  validateTeamTierCombo
} = require("../lib/tierRestrictions");

const {
  formatInvalidGenderSignupMessage,
  validateTeamGenderCombo
} = require("../lib/genderRestrictions");

const { memberHasEventBanRole } = require("../lib/eventBanRoles");

const {
  RULES_ACK_EMOJI_ID,
  findRulesAcknowledgementChannel,
  isTeamAcknowledged,
  loadRulesAcknowledgementMessages
} = require("../lib/rulesAcknowledgement");

const { forEachGuildMemberPage } = require("../lib/guildMemberList");

const {
  collectMentionedUsersFromMessages,
  getNonBotMentionedUsers,
  messageHasExactTaggedPlayers,
  buildFlaggedTeamLookup,
  resolveValidTeamsInSignupOrder,
  splitValidTeams,
  syncInvalidSignupReactions,
  syncNonAcceptedSignupReactions
} = require("../lib/signupTeamScan");

// ================= CONSTANTS =================
const LOG_CHANNEL_ID = "1471082166535454780";
const SHEET_ID = process.env.MAIN_SHEET_ID;
const AUDIT_RANGE = "Audit Log!A:G";

const MESSAGE_SCAN_LIMIT = 100;
const ROLE_BATCH_SIZE = 5;
const ROLE_BATCH_DELAY_MS = 200;
const REACTION_DELAY_MS = 100;
const REACT_ADD_DELAY_MS = 300;
const BAN_PROMPT_TIMEOUT_MS = 120_000;

/** @type {Map<string, { slashUserId: string, prompt: import("discord.js").Message, timeoutId: NodeJS.Timeout, resolve: (decision: string) => void }>} */
const pendingBanDecisions = new Map();

function parseRoletaggedBanButtonCustomId(customId) {
  const match = customId.match(
    /^roletagged_ban_(skip|include|cancel)_(.+)$/
  );
  if (!match) {
    return null;
  }
  return {
    choice: match[1],
    slashInteractionId: match[2]
  };
}

// ================= EMOJIS =================
const ACCEPTED_EMOJI_ID = "1405510864496361482";

const NUMBER_EMOJIS = {
  "0": "1405509686194864188",
  "1": "1405509032705392685",
  "2": "1405509125500309636",
  "3": "1405509179291992165",
  "4": "1405509225144389734",
  "5": "1405509441054572577",
  "6": "1405509486533148763",
  "7": "1405509549246386218",
  "8": "1405509615529230347",
  "9": "1405509655702274210"
};

const DUPLICATE_NUMBER_EMOJIS = {
  "1": "1436347038630416499",
  "2": "1436348495102480424",
  "3": "1436348527448952923",
  "4": "1436348563591266424",
  "5": "1436348591986708601",
  "6": "1436348649616707695",
  "7": "1436348677341053069",
  "8": "1436348705652478004",
  "9": "1436348734731587645"
};

// ================= TEAM LIMITS =================
const TEAM_LIMITS = {
  normal: {
    1: 100,
    2: 50,
    3: 33,
    4: 25
  },
  reload: {
    1: 40,
    2: 25,
    3: 16,
    4: 13
  }
};

const MODE_LABELS = {
  1: "Solo",
  2: "Duos",
  3: "Trios",
  4: "Squads"
};

const RELOAD_STOP_EMOJI = "✋";

const RELOAD_K_EMOJI =
  "1435978450958553130";

// ================= HELPERS =================
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const isoNow = () => new Date().toISOString();

async function sendRoletaggedReply(interaction, content) {
  const payload =
    typeof content === "string"
      ? { content }
      : content;

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
      return;
    }

    await interaction.reply({
      ...payload,
      ephemeral: false
    });
  } catch (err) {
    if (err?.code !== 10008) {
      throw err;
    }

    try {
      await interaction.followUp({
        ...payload,
        ephemeral: false
      });
    } catch (followUpErr) {
      console.error(
        "[ROLETAGGED] Could not deliver command result:",
        followUpErr
      );
    }
  }
}

async function logAudit(data) {
  await getSheets().spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: AUDIT_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        isoNow(),
        data.action,
        data.moderator.id,
        data.moderator.tag,
        "",
        "",
        data.context
      ]]
    }
  });
}

function getNumberReactionEmojis(number) {
  const digits =
    number
    .toString()
    .split("");

  const digitUsage = {};
  const emojis = [];

  for (const digit of digits) {
    if (!digitUsage[digit]) {
      digitUsage[digit] = 0;
    }

    digitUsage[digit]++;

    const emoji =
      digitUsage[digit] === 1
        ? NUMBER_EMOJIS[digit]
        : DUPLICATE_NUMBER_EMOJIS[digit];

    if (emoji) {
      emojis.push(
        emoji
      );
    }
  }

  return emojis;
}

function reactionKey(emoji) {
  return emoji.id || emoji.name;
}

function buildExpectedReactionKeys(
  teamNumber,
  { asOverflow = false, acknowledged = false } = {}
) {
  const keys = asOverflow
    ? [
      RELOAD_STOP_EMOJI,
      RELOAD_K_EMOJI,
      ...getNumberReactionEmojis(teamNumber)
    ]
    : [
      ACCEPTED_EMOJI_ID,
      ...getNumberReactionEmojis(teamNumber)
    ];

  if (acknowledged) {
    keys.push(RULES_ACK_EMOJI_ID);
  }

  return keys.sort();
}

async function ensureMessageReactionsLoaded(message) {
  if (message.partial) {
    await message.fetch();
  }
}

function getMessageReactionKeysSorted(message) {
  const keys = [];

  for (const reaction of message.reactions.cache.values()) {
    if (reaction.count > 0) {
      keys.push(reactionKey(reaction.emoji));
    }
  }

  return keys.sort();
}

function teamSignupReactionsMatch(
  message,
  teamNumber,
  { asOverflow = false, acknowledged = false } = {}
) {
  const expected = buildExpectedReactionKeys(teamNumber, {
    asOverflow,
    acknowledged
  });
  const actual = getMessageReactionKeysSorted(message);

  if (expected.length !== actual.length) {
    return false;
  }

  return expected.every((key, index) => key === actual[index]);
}

async function clearAllMessageReactions(message) {
  await ensureMessageReactionsLoaded(message);

  for (const reaction of message.reactions.cache.values()) {
    const users = await reaction.users.fetch();

    for (const user of users.values()) {
      await reaction.users.remove(user.id);
      await delay(REACTION_DELAY_MS);
    }
  }
}

async function syncTeamSignupReactions(
  message,
  teamNumber,
  { asOverflow = false, acknowledged = false } = {}
) {
  const reactionOrder = asOverflow
    ? [
      RELOAD_STOP_EMOJI,
      RELOAD_K_EMOJI,
      ...getNumberReactionEmojis(teamNumber)
    ]
    : [
      ACCEPTED_EMOJI_ID,
      ...getNumberReactionEmojis(teamNumber)
    ];

  if (acknowledged) {
    reactionOrder.push(RULES_ACK_EMOJI_ID);
  }

  await clearAllMessageReactions(message);

  for (const emoji of reactionOrder) {
    await message.react(emoji);
    await delay(REACT_ADD_DELAY_MS);
  }
}

async function applyTeamSignupReactions(
  teams,
  {
    asOverflow = false,
    startNumber = 1,
    acknowledgementMessages = null,
    teamLabel = null
  } = {}
) {
  const missingLabels = [];
  let teamNumber = startNumber;

  for (const team of teams) {
    let acknowledged = false;

    if (acknowledgementMessages !== null) {
      const memberIds = team.users.map(user => user.id);

      acknowledged = isTeamAcknowledged(
        memberIds,
        acknowledgementMessages
      );

      if (!acknowledged && teamLabel) {
        missingLabels.push(`${teamLabel} ${teamNumber}`);
      }
    }

    const reactionOptions = {
      asOverflow,
      acknowledged
    };

    try {
      await ensureMessageReactionsLoaded(team.message);

      if (
        !teamSignupReactionsMatch(
          team.message,
          teamNumber,
          reactionOptions
        )
      ) {
        await syncTeamSignupReactions(
          team.message,
          teamNumber,
          reactionOptions
        );
      }
    } catch (err) {
      console.error(
        asOverflow ? "[OVERFLOW REACT ERROR]" : "[REACT ERROR]",
        err
      );
    }

    teamNumber++;
  }

  return missingLabels;
}

function formatMissingRulesAckNote(missingLabels) {
  if (!missingLabels.length) {
    return "\nRules acknowledgement: all valid teams acknowledged.";
  }

  return (
    `\nTeams missing rules acknowledgement: ${missingLabels.length}\n` +
    missingLabels.join("\n")
  );
}

async function clearSkippedBannedSignupReactions(skippedBannedTeams) {
  for (const { team } of skippedBannedTeams) {
    try {
      await clearAllMessageReactions(team.message);
    } catch (err) {
      console.error("[SKIP BANNED REACT ERROR]", err);
    }
  }
}

async function assignRolesInBatches(
  guild,
  userIds,
  role
) {

  let added = 0;
  let skipped = 0;
  const ids = [...userIds];

  for (let i = 0; i < ids.length; i += ROLE_BATCH_SIZE) {

    const batch = ids.slice(i, i + ROLE_BATCH_SIZE);

    await Promise.all(
      batch.map(async (userId) => {

        let member = guild.members.cache.get(userId);

        if (!member) {
          member = await guild.members.fetch(userId).catch(() => null);
        }

        if (!member) {
          return;
        }

        if (member.roles.cache.has(role.id)) {
          skipped++;
          return;
        }

        try {
          await member.roles.add(role);
          added++;
        } catch (err) {
          console.error(err);
        }

      })
    );

    if (i + ROLE_BATCH_SIZE < ids.length) {
      await delay(ROLE_BATCH_DELAY_MS);
    }

  }

  return { added, skipped };

}

async function removeRolesInBatches(
  guild,
  userIds,
  role
) {

  let removed = 0;
  let skipped = 0;
  const ids = [...userIds];

  for (let i = 0; i < ids.length; i += ROLE_BATCH_SIZE) {

    const batch = ids.slice(i, i + ROLE_BATCH_SIZE);

    await Promise.all(
      batch.map(async (userId) => {

        let member = guild.members.cache.get(userId);

        if (!member) {
          member = await guild.members.fetch(userId).catch(() => null);
        }

        if (!member) {
          return;
        }

        if (!member.roles.cache.has(role.id)) {
          skipped++;
          return;
        }

        try {
          await member.roles.remove(role);
          removed++;
        } catch (err) {
          console.error(err);
        }

      })
    );

    if (i + ROLE_BATCH_SIZE < ids.length) {
      await delay(ROLE_BATCH_DELAY_MS);
    }

  }

  return { removed, skipped };

}

async function syncSignupChannelRoles(
  guild,
  role,
  keepUserIds,
  {
    removeMissingRoles = true,
    removeScopeUserIds = null,
    removeKeepUserIds = keepUserIds
  } = {}
) {

  const removeUserIds = new Set();

  if (removeMissingRoles) {
    if (removeScopeUserIds) {
      for (const userId of removeScopeUserIds) {
        if (!removeKeepUserIds.has(userId)) {
          removeUserIds.add(userId);
        }
      }
    } else {
      await forEachGuildMemberPage(guild, async batch => {
        for (const member of batch.values()) {
          if (member.user.bot) {
            continue;
          }

          if (!member.roles.cache.has(role.id)) {
            continue;
          }

          if (removeKeepUserIds.has(member.id)) {
            continue;
          }

          removeUserIds.add(member.id);
        }
      });
    }
  }

  const { removed, skipped: removeSkipped } =
    await removeRolesInBatches(
      guild,
      removeUserIds,
      role
    );

  const { added, skipped } = await assignRolesInBatches(
    guild,
    keepUserIds,
    role
  );

  return {
    added,
    skipped,
    removed,
    removeSkipped
  };

}

function buildFlaggedBanSummary(flaggedTeams) {

  const lines = flaggedTeams.map(({ team, blockReason }) =>
    `• ${team.users.map(u => `<@${u.id}>`).join(" ")} — ${formatSignupBlockMessage(blockReason)}`
  );

  return lines.join("\n").slice(0, 3500);

}

async function promptBannedTeamDecision(interaction, flaggedTeams) {

  const summary = buildFlaggedBanSummary(flaggedTeams);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`roletagged_ban_skip_${interaction.id}`)
      .setLabel("Skip banned teams")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`roletagged_ban_include_${interaction.id}`)
      .setLabel("Role banned teams too")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`roletagged_ban_cancel_${interaction.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  const prompt = await interaction.followUp({
    content:
      `**${flaggedTeams.length} signup team(s) include players with an active event ban** ` +
      `\n\n${summary}\n\nChoose how to continue:`,
    components: [row],
    ephemeral: true
  });

  return new Promise(resolve => {
    const timeoutId = setTimeout(() => {
      const pending = pendingBanDecisions.get(interaction.id);
      if (!pending) {
        return;
      }
      pendingBanDecisions.delete(interaction.id);
      prompt
        .edit({
          content: "Timed out — cancelled. Run /roletagged again.",
          components: []
        })
        .catch(() => {});
      resolve("cancel");
    }, BAN_PROMPT_TIMEOUT_MS);

    pendingBanDecisions.set(interaction.id, {
      slashUserId: interaction.user.id,
      prompt,
      timeoutId,
      resolve: decision => {
        clearTimeout(timeoutId);
        pendingBanDecisions.delete(interaction.id);
        resolve(decision);
      }
    });
  });

}

async function finishRoletagged(
  interaction,
  {
    validTeams,
    skippedBannedTeams,
    includedDespiteBan,
    genderRejectedCount = 0,
    tierRejectedCount,
    invalidSignupsMarked,
    scannedMessages,
    emptyResultLabel,
    role,
    isReload,
    requiredTeamSize,
    twoLobbies,
    channel,
    guild
  }
) {

  const {
    roledTeams,
    lobby1Teams,
    lobby2Teams,
    overflowTeams
  } = splitValidTeams(validTeams, {
    isReload,
    requiredTeamSize,
    twoLobbies
  });

  const roledUserIds =
    new Set();

  for (const team of roledTeams) {

    for (const user of team.users) {
      roledUserIds.add(user.id);
    }

  }

  const channelParticipantIds = new Set(
    collectMentionedUsersFromMessages(scannedMessages).map(user => user.id)
  );

  const {
    added,
    skipped,
    removed,
    removeSkipped
  } = await syncSignupChannelRoles(
    guild,
    role,
    roledUserIds,
    {
      removeKeepUserIds: channelParticipantIds
    }
  );

  let rulesAckNote = "";
  let acknowledgementMessages = null;
  const category = channel.parent;

  if (!category) {
    rulesAckNote =
      "\nRules acknowledgement: skipped (signup channel is not in an event category).";
  } else {
    const rulesChannel = findRulesAcknowledgementChannel(
      guild,
      category.id
    );

    if (!rulesChannel) {
      rulesAckNote =
        "\nRules acknowledgement: no acknowledge-rules channel found in this category.";
    } else {
      acknowledgementMessages =
        await loadRulesAcknowledgementMessages(rulesChannel);
    }
  }

  const missingRulesLabels = [];

  const acceptedMessageIds = new Set();

  if (validTeams.length > 0) {
    for (const team of [...roledTeams, ...overflowTeams]) {
      acceptedMessageIds.add(team.message.id);
    }

    if (twoLobbies) {
      missingRulesLabels.push(
        ...(await applyTeamSignupReactions(lobby1Teams, {
          acknowledgementMessages,
          teamLabel: "Lobby 1 Team"
        }))
      );

      missingRulesLabels.push(
        ...(await applyTeamSignupReactions(lobby2Teams, {
          acknowledgementMessages,
          teamLabel: "Lobby 2 Team"
        }))
      );
    } else {
      missingRulesLabels.push(
        ...(await applyTeamSignupReactions(roledTeams, {
          acknowledgementMessages,
          teamLabel: "Team"
        }))
      );
    }

    if (overflowTeams.length > 0) {
      missingRulesLabels.push(
        ...(await applyTeamSignupReactions(overflowTeams, {
          asOverflow: true,
          acknowledgementMessages,
          teamLabel: "Overflow Team"
        }))
      );
    }
  }

  const rejectedSignupsMarked =
    await syncNonAcceptedSignupReactions(
      scannedMessages,
      acceptedMessageIds
    );

  if (acknowledgementMessages !== null) {
    rulesAckNote = formatMissingRulesAckNote(missingRulesLabels);
  }

  const banNote = includedDespiteBan
    ? "\nBanned teams: included by moderator"
    : skippedBannedTeams.length > 0
      ? `\nBanned teams skipped: ${skippedBannedTeams.length}`
      : "";

  const genderNote =
    genderRejectedCount > 0
      ? `\nInvalid gender combos rejected: ${genderRejectedCount}`
      : "";

  const tierNote =
    tierRejectedCount > 0
      ? `\nInvalid tier combos rejected: ${tierRejectedCount}`
      : "";

  const invalidSignupNote =
    invalidSignupsMarked > 0 || rejectedSignupsMarked > 0
      ? `\nInvalid signups marked ✋: ${invalidSignupsMarked + rejectedSignupsMarked}`
      : "";

  const lobbyNote = twoLobbies
    ? "\nTwo lobbies: Yes\n" +
      "Lobby 1 Teams: " + lobby1Teams.length + "\n" +
      "Lobby 2 Teams: " + lobby2Teams.length
    : "";

  const modeLabel =
    (MODE_LABELS[requiredTeamSize] || requiredTeamSize) +
    (twoLobbies ? " (capacity per lobby)" : "");

  const detailedResult =
    (validTeams.length === 0
      ? (emptyResultLabel || "No teams selected for role assignment.") + "\n"
      : "Role assignment complete\n") +
      "Mode: " + modeLabel + "\n" +
      "Reload: " + (isReload ? "Yes" : "No") + "\n" +
    "Role: " + role.name + "\n" +
    "Added: " + added + "\n" +
    "Skipped: " + skipped + "\n" +
    "Removed: " + removed + "\n" +
    "Remove skipped: " + removeSkipped + "\n" +
    "Valid Teams: " + validTeams.length + "\n" +
    "Roled Teams: " + roledTeams.length + "\n" +
    "Overflow Teams: " + overflowTeams.length +
    lobbyNote +
    banNote +
    genderNote +
    tierNote +
    invalidSignupNote +
    rulesAckNote;

  const publicResult =
    validTeams.length === 0
      ? (emptyResultLabel || "No teams selected for role assignment.")
      : `${role.name} ${MODE_LABELS[requiredTeamSize] || requiredTeamSize}, ${validTeams.length} valid teams`;

  try {

    const logChannel =
      await guild.channels.fetch(LOG_CHANNEL_ID);

    await logChannel.send(
      "Role Assigned via /roletagged\n" +
      "Moderator: " +
      interaction.user.tag +
      "\n" +
      detailedResult
    );

  } catch {}

  try {

    await logAudit({

      action: "ROLE_TAGGED_ASSIGN",

      moderator: interaction.user,

      context:
        `role=${role.id} mode=${requiredTeamSize} reload=${isReload} ` +
        `two_lobbies=${twoLobbies} teams=${validTeams.length} ` +
        `included_banned=${includedDespiteBan} skipped_banned=${skippedBannedTeams.length}`
    });

  } catch (err) {

    console.error(err);

  }

  await sendRoletaggedReply(interaction, publicResult);

}

// ================= COMMAND =================
module.exports = {

  data: new SlashCommandBuilder()
    .setName("roletagged")
    .setDescription("Give roles to tagged users from signups")

    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to give")
        .setRequired(true)
    )

    .addStringOption(o =>
      o.setName("mode")
        .setDescription("Team size")
        .setRequired(true)
        .addChoices(
          { name: "Solos (no tier check)", value: "1" },
          { name: "Duos", value: "2" },
          { name: "Trios", value: "3" },
          { name: "Squads", value: "4" }
        )
    )

    .addBooleanOption(o =>
      o.setName("reload")
        .setDescription("Reload mode (reduced team limits)")
        .setRequired(false)
    )

    .addBooleanOption(o =>
      o.setName("two_lobbies")
        .setDescription(
          "Two lobbies: fill overflow only after both lobbies; renumber lobby 2 from 1"
        )
        .setRequired(false)
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageRoles
    ),

  async execute(interaction) {

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    if (!process.env.MAIN_SHEET_ID) {
      return sendRoletaggedReply(interaction, {
        content: "MAIN_SHEET_ID not configured."
      });
    }

    const role =
      interaction.options.getRole("role");

    const isReload =
      interaction.options.getBoolean("reload") || false;

    const twoLobbies =
      interaction.options.getBoolean("two_lobbies") || false;

    const requiredTeamSize =
      parseInt(
        interaction.options.getString("mode")
      );

    const channel = interaction.channel;
    const guild = interaction.guild;

    let eventBanRows = [];

    try {
      eventBanRows = await getRows();
    } catch (err) {
      console.error("[ROLETAGGED] Event ban sheet read failed:", err);
      return sendRoletaggedReply(
        interaction,
        "Could not load Event Bans sheet. Try again later."
      );
    }

    const messages =
      await channel.messages.fetch({
        limit: MESSAGE_SCAN_LIMIT
      });

    const eligibleTeams = [];

    const flaggedTeams = [];

    const candidateTeams = [];

    const playerSignupMap =
      new Map();

    const orderedMessages =
      [...messages.values()].reverse();

    const invalidSignupsMarked =
      await syncInvalidSignupReactions(
        orderedMessages,
        requiredTeamSize
      );

    // ================= SCAN =================

    for (const msg of orderedMessages) {

      if (
        !messageHasExactTaggedPlayers(
          msg,
          requiredTeamSize
        )
      ) {
        continue;
      }

      const users = getNonBotMentionedUsers(msg);

      candidateTeams.push({
        message: msg,
        users
      });

      for (const user of users) {

        if (
          !playerSignupMap.has(
            user.id
          )
        ) {
          playerSignupMap.set(
            user.id,
            []
          );
        }

        playerSignupMap
          .get(user.id)
          .push(msg.id);
      }
    }

    // ================= DUPLICATES =================

    const duplicatePlayers =
      new Set();

    for (const [id, signups]
      of playerSignupMap) {

      if (
        signups.length > 1
      ) {
        duplicatePlayers.add(
          id
        );
      }
    }

    // ================= VALIDATE =================

    let genderRejectedCount = 0;
    let tierRejectedCount = 0;

    for (const team of candidateTeams) {

      const hasDuplicate =
        team.users.some(
          u =>
          duplicatePlayers.has(
            u.id
          )
        );

      if (hasDuplicate) {

        const dupes = team.users.filter(
          u => duplicatePlayers.has(u.id)
        );

        try {

          await channel.send(
            dupes.length === 1
              ? `<@${dupes[0].id}> player is signed up twice!`
              : `${dupes.map(u => `<@${u.id}>`).join(" ")} players are signed up twice!`
          );

        } catch {}

        continue;
      }

      if (requiredTeamSize > 1) {

        const genderCheck = await validateTeamGenderCombo(
          guild,
          team.users,
          requiredTeamSize
        );

        if (!genderCheck.ok) {

          genderRejectedCount++;

          try {

            await channel.send(
              formatInvalidGenderSignupMessage(genderCheck)
            );

          } catch {}

          continue;

        }

      }

      const teamSizeForTier = requiredTeamSize;

      if (teamSizeForTier > 1) {

        const tierCheck = await validateTeamTierCombo(
          guild,
          team.users,
          teamSizeForTier
        );

        if (!tierCheck.ok) {

          tierRejectedCount++;

          try {

            await channel.send(
              formatInvalidTierSignupMessage({
                users: team.users,
                tiers: tierCheck.tiers,
                teamSize: teamSizeForTier,
                reason: tierCheck.reason,
                ambiguousUser: tierCheck.ambiguousUser
              })
            );

          } catch {}

          continue;

        }

      }

      let blockReason = null;

      for (const user of team.users) {

        const sheetBlockReason = getSignupBlockReason(
          user.id,
          eventBanRows
        );

        if (!sheetBlockReason) {
          continue;
        }

        const hasEventBanRole =
          await memberHasEventBanRole(guild, user.id);

        if (!hasEventBanRole) {
          console.warn(
            "[ROLETAGGED] Ignoring active event-ban sheet row because member lacks role:",
            user.id
          );
          continue;
        }

        blockReason = sheetBlockReason;

        if (blockReason) {
          break;
        }

      }

      if (blockReason) {

        flaggedTeams.push({
          team,
          blockReason
        });

        continue;
      }

      eligibleTeams.push(team);

    }

    if (
      eligibleTeams.length === 0 &&
      flaggedTeams.length === 0
    ) {
      await sendRoletaggedReply(
        interaction,
        "Processing signup cleanup…"
      );

      return finishRoletagged(interaction, {
        validTeams: [],
        skippedBannedTeams: [],
        includedDespiteBan: false,
        genderRejectedCount,
        tierRejectedCount,
        invalidSignupsMarked,
        scannedMessages: orderedMessages,
        emptyResultLabel: "No eligible signups found.",
        role,
        isReload,
        requiredTeamSize,
        twoLobbies,
        channel,
        guild
      });
    }

    const eligibleMessageIds = new Set(
      eligibleTeams.map(team => team.message.id)
    );
    const flaggedByMessageId =
      buildFlaggedTeamLookup(flaggedTeams);

    let validTeams = [...eligibleTeams];
    let skippedBannedTeams = [];
    let includedDespiteBan = false;

    if (flaggedTeams.length > 0) {

      await sendRoletaggedReply(
        interaction,
        `Scan complete. Found **${flaggedTeams.length}** team(s) with an active event ban. Choose an option below (only you can see this).`
      );

      const decision =
        await promptBannedTeamDecision(
          interaction,
          flaggedTeams
        );

      if (decision === "cancel") {

        return sendRoletaggedReply(
          interaction,
          "Cancelled — no roles were assigned."
        );

      }

      const includeBanned = decision === "include";

      ({ validTeams, skippedBannedTeams } =
        resolveValidTeamsInSignupOrder(
          candidateTeams,
          eligibleMessageIds,
          flaggedByMessageId,
          includeBanned
        ));

      if (includeBanned) {

        includedDespiteBan = true;

      } else {

        for (const { team, blockReason } of skippedBannedTeams) {

          try {

            await channel.send(
              `Skipped signup (event ban): ${team.users.map(
                u => `<@${u.id}>`
              ).join(" ")}\n${formatSignupBlockMessage(blockReason)}`
            );

          } catch {}

        }

        await clearSkippedBannedSignupReactions(
          skippedBannedTeams
        );

      }

    }

    await sendRoletaggedReply(
      interaction,
      validTeams.length === 0
        ? "Processing signup cleanup…"
        : "Processing role assignment and signup reactions…"
    );

    await finishRoletagged(interaction, {
      validTeams,
      skippedBannedTeams,
      includedDespiteBan,
      genderRejectedCount,
      tierRejectedCount,
      invalidSignupsMarked,
      scannedMessages: orderedMessages,
      role,
      isReload,
      requiredTeamSize,
      twoLobbies,
      channel,
      guild
    });

  },

  async handleButton(interaction) {
    const parsed = parseRoletaggedBanButtonCustomId(
      interaction.customId
    );
    if (!parsed) {
      return false;
    }

    const pending = pendingBanDecisions.get(
      parsed.slashInteractionId
    );

    if (
      !pending ||
      pending.slashUserId !== interaction.user.id
    ) {
      await interaction.reply({
        content:
          "This prompt expired. Run /roletagged again.",
        ephemeral: true
      });
      return true;
    }

    await interaction.deferUpdate();

    const label =
      interaction.component?.label || "Selected";

    await pending.prompt
      .edit({
        content: label + " — continuing…",
        components: []
      })
      .catch(() => {});

    const decision =
      parsed.choice === "cancel"
        ? "cancel"
        : parsed.choice === "include"
          ? "include"
          : "skip";

    pending.resolve(decision);
    return true;
  }
};
