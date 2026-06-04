const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
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
  RULES_ACK_EMOJI_ID,
  findRulesAcknowledgementChannel,
  isTeamAcknowledged,
  loadRulesAcknowledgementMessages
} = require("../lib/rulesAcknowledgement");

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
    2: 20,
    3: 13,
    4: 10
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

const MANAGED_REACTION_EMOJIS =
  new Set([
    ACCEPTED_EMOJI_ID,
    RELOAD_STOP_EMOJI,
    RELOAD_K_EMOJI,
    ...Object.values(NUMBER_EMOJIS),
    ...Object.values(DUPLICATE_NUMBER_EMOJIS)
  ]);

// ================= HELPERS =================
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const isoNow = () => new Date().toISOString();

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

function managedReactionsLookCorrect(
  message,
  expectedEmojis
) {

  const botManaged = [];

  for (const reaction of message.reactions.cache.values()) {

    const emoji =
      reaction.emoji.id ||
      reaction.emoji.name;

    if (!MANAGED_REACTION_EMOJIS.has(emoji)) {
      continue;
    }

    if (reaction.count > 1 || !reaction.me) {
      return false;
    }

    botManaged.push(emoji);

  }

  return (
    botManaged.length === expectedEmojis.length &&
    botManaged.every(
      (emoji, index) => emoji === expectedEmojis[index]
    )
  );

}

async function reconcileManagedReactions(message, botUserId, expectedEmojis) {

  if (message.partial) {
    await message.fetch();
  }

  if (managedReactionsLookCorrect(message, expectedEmojis)) {
    return new Set(expectedEmojis);
  }

  const existingBotManaged = [];

  for (const reaction of message.reactions.cache.values()) {

    const emoji =
      reaction.emoji.id ||
      reaction.emoji.name;

    if (!MANAGED_REACTION_EMOJIS.has(emoji)) {
      continue;
    }

    if (reaction.count > 1 || !reaction.me) {

      const users = await reaction.users.fetch();

      for (const user of users.values()) {

        if (user.id !== botUserId) {
          await reaction.users.remove(user.id);
          await delay(REACTION_DELAY_MS);
        }

      }

    }

    if (reaction.me) {
      existingBotManaged.push({
        reaction,
        emoji
      });
    }

  }

  const existingEmojis =
    existingBotManaged.map(
      item => item.emoji
    );

  const alreadyCorrect =
    existingEmojis.length === expectedEmojis.length &&
    existingEmojis.every(
      (emoji, index) => emoji === expectedEmojis[index]
    );

  if (alreadyCorrect) {
    return new Set(
      existingEmojis
    );
  }

  for (const item of existingBotManaged) {
    await item.reaction.users.remove(
      botUserId
    );
    await delay(REACTION_DELAY_MS);
  }

  return new Set();
}

async function reactIfMissing(message, emoji, existing) {
  if (
    existing.has(
      emoji
    )
  ) {
    return;
  }

  await message.react(
    emoji
  );

  await delay(REACT_ADD_DELAY_MS);

  existing.add(
    emoji
  );
}

async function reconcileRulesAckReaction(
  message,
  botUserId,
  acknowledged
) {
  if (message.partial) {
    await message.fetch();
  }

  const rulesReactions = message.reactions.cache.filter(
    reaction => reaction.emoji.id === RULES_ACK_EMOJI_ID
  );

  for (const reaction of rulesReactions.values()) {
    if (reaction.count > 1 || !reaction.me) {
      const users = await reaction.users.fetch();

      for (const user of users.values()) {
        if (user.id !== botUserId) {
          await reaction.users.remove(user.id);
          await delay(REACTION_DELAY_MS);
        }
      }
    }

    if (reaction.me) {
      await reaction.users.remove(botUserId);
      await delay(REACTION_DELAY_MS);
    }
  }

  if (acknowledged) {
    await message.react(RULES_ACK_EMOJI_ID);
    await delay(REACT_ADD_DELAY_MS);
  }
}

async function applyRulesAcknowledgementForTeams(
  interaction,
  teams,
  acknowledgementMessages,
  { teamLabel, startNumber = 1 }
) {
  const missingLabels = [];

  for (let index = 0; index < teams.length; index++) {
    const team = teams[index];
    const teamNumber = startNumber + index;
    const memberIds = team.users.map(user => user.id);
    const acknowledged = isTeamAcknowledged(
      memberIds,
      acknowledgementMessages
    );

    try {
      await reconcileRulesAckReaction(
        team.message,
        interaction.client.user.id,
        acknowledged
      );
    } catch (err) {
      console.error("[ROLETAGGED] rules ack reaction:", err);
    }

    if (!acknowledged) {
      missingLabels.push(`${teamLabel} ${teamNumber}`);
    }
  }

  return missingLabels;
}

async function applyRulesAcknowledgementMarkers(
  interaction,
  {
    twoLobbies,
    lobby1Teams,
    lobby2Teams,
    roledTeams,
    overflowTeams,
    acknowledgementMessages
  }
) {
  const missingLabels = [];

  if (twoLobbies) {
    missingLabels.push(
      ...(await applyRulesAcknowledgementForTeams(
        interaction,
        lobby1Teams,
        acknowledgementMessages,
        { teamLabel: "Lobby 1 Team" }
      ))
    );

    missingLabels.push(
      ...(await applyRulesAcknowledgementForTeams(
        interaction,
        lobby2Teams,
        acknowledgementMessages,
        { teamLabel: "Lobby 2 Team" }
      ))
    );
  } else {
    missingLabels.push(
      ...(await applyRulesAcknowledgementForTeams(
        interaction,
        roledTeams,
        acknowledgementMessages,
        { teamLabel: "Team" }
      ))
    );
  }

  if (overflowTeams.length > 0) {
    missingLabels.push(
      ...(await applyRulesAcknowledgementForTeams(
        interaction,
        overflowTeams,
        acknowledgementMessages,
        { teamLabel: "Overflow Team" }
      ))
    );
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

  try {

    const choice = await prompt.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: BAN_PROMPT_TIMEOUT_MS,
      filter: i =>
        i.user.id === interaction.user.id &&
        i.customId.endsWith(interaction.id)
    });

    await choice.deferUpdate();

    await prompt.edit({
      content: choice.component.label + " — continuing…",
      components: []
    });

    if (choice.customId.startsWith("roletagged_ban_cancel_")) {
      return "cancel";
    }

    if (choice.customId.startsWith("roletagged_ban_include_")) {
      return "include";
    }

    return "skip";

  } catch {

    await prompt.edit({
      content: "Timed out — cancelled. Run /roletagged again.",
      components: []
    }).catch(() => {});

    return "cancel";

  }

}

async function applyTeamNumberReactions(
  interaction,
  teams,
  { asOverflow = false, startNumber = 1 }
) {

  let teamNumber = startNumber;

  for (const team of teams) {

    try {

      const expectedEmojis = asOverflow
        ? [
          RELOAD_STOP_EMOJI,
          RELOAD_K_EMOJI,
          ...getNumberReactionEmojis(teamNumber)
        ]
        : [
          ACCEPTED_EMOJI_ID,
          ...getNumberReactionEmojis(teamNumber)
        ];

      const existing =
        await reconcileManagedReactions(
          team.message,
          interaction.client.user.id,
          expectedEmojis
        );

      for (const emojiId of expectedEmojis) {
        await reactIfMissing(
          team.message,
          emojiId,
          existing
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

}

async function finishRoletagged(
  interaction,
  {
    validTeams,
    skippedBannedTeams,
    includedDespiteBan,
    tierRejectedCount,
    role,
    isReload,
    requiredTeamSize,
    twoLobbies,
    channel,
    guild
  }
) {

  if (validTeams.length === 0) {

    return interaction.editReply(
      "No teams selected for role assignment."
    );

  }

  const teamLimit =
    TEAM_LIMITS[isReload ? "reload" : "normal"][requiredTeamSize];

  let roledTeams;
  let lobby1Teams = [];
  let lobby2Teams = [];
  let overflowTeams;

  if (twoLobbies) {

    lobby1Teams = validTeams.slice(0, teamLimit);
    lobby2Teams = validTeams.slice(teamLimit, teamLimit * 2);
    overflowTeams = validTeams.slice(teamLimit * 2);
    roledTeams = [...lobby1Teams, ...lobby2Teams];

  } else {

    roledTeams = validTeams.slice(0, teamLimit);
    overflowTeams = validTeams.slice(teamLimit);

  }

  const roledUserIds =
    new Set();

  for (const team of roledTeams) {

    for (const user of team.users) {
      roledUserIds.add(user.id);
    }

  }

  const { added, skipped } = await assignRolesInBatches(
    guild,
    roledUserIds,
    role
  );

  if (twoLobbies) {

    await applyTeamNumberReactions(
      interaction,
      lobby1Teams,
      { startNumber: 1 }
    );

    await applyTeamNumberReactions(
      interaction,
      lobby2Teams,
      { startNumber: 1 }
    );

  } else {

    await applyTeamNumberReactions(
      interaction,
      roledTeams,
      { startNumber: 1 }
    );

  }

  if (overflowTeams.length > 0) {

    await applyTeamNumberReactions(
      interaction,
      overflowTeams,
      { asOverflow: true, startNumber: 1 }
    );

  }

  let rulesAckNote = "";

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
      const acknowledgementMessages =
        await loadRulesAcknowledgementMessages(rulesChannel);

      const missingLabels = await applyRulesAcknowledgementMarkers(
        interaction,
        {
          twoLobbies,
          lobby1Teams,
          lobby2Teams,
          roledTeams,
          overflowTeams,
          acknowledgementMessages
        }
      );

      rulesAckNote = formatMissingRulesAckNote(missingLabels);
    }
  }

  const banNote = includedDespiteBan
    ? "\nBanned teams: included by moderator"
    : skippedBannedTeams.length > 0
      ? `\nBanned teams skipped: ${skippedBannedTeams.length}`
      : "";

  const tierNote =
    tierRejectedCount > 0
      ? `\nInvalid tier combos rejected: ${tierRejectedCount}`
      : "";

  const lobbyNote = twoLobbies
    ? "\nTwo lobbies: Yes\n" +
      "Lobby 1 Teams: " + lobby1Teams.length + "\n" +
      "Lobby 2 Teams: " + lobby2Teams.length
    : "";

  const result =

    "Role assignment complete\n" +
      "Mode: " + (MODE_LABELS[requiredTeamSize] || requiredTeamSize) +
      (twoLobbies ? " (capacity per lobby)" : "") + "\n" +
      "Reload: " + (isReload ? "Yes" : "No") + "\n" +
    "Role: " + role.name + "\n" +
    "Added: " + added + "\n" +
    "Skipped: " + skipped + "\n" +
    "Valid Teams: " + validTeams.length + "\n" +
    "Roled Teams: " + roledTeams.length + "\n" +
    "Overflow Teams: " + overflowTeams.length +
    lobbyNote +
    banNote +
    tierNote +
    rulesAckNote;

  await interaction.editReply(result);

  try {

    const logChannel =
      await guild.channels.fetch(LOG_CHANNEL_ID);

    await logChannel.send(

      "Role Assigned via /roletagged\n" +
      "Moderator: " +
      interaction.user.tag +
      "\nRole: " +
      role.name +
      "\nMode: " +
      (MODE_LABELS[requiredTeamSize] || requiredTeamSize) +
      "\nReload: " +
      (isReload ? "Yes" : "No") +
      (twoLobbies
        ? "\nTwo lobbies: Yes (L1=" + lobby1Teams.length +
          " L2=" + lobby2Teams.length + ")"
        : "") +
      "\nTeams: " +
      validTeams.length +
      banNote +
      tierNote
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
          "Two lobbies: any team size, fill overflow only after both lobbies; renumber lobby 2 from 1"
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
      return interaction.editReply({
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
      return interaction.editReply(
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

    // ================= SCAN =================

    for (const msg of orderedMessages) {

      const users =
        [...msg.mentions.users.values()]
        .filter(u => !u.bot);

      if (users.length === 0)
        continue;

      if (twoLobbies) {

        if (
          users.length < 1 ||
          users.length > 4
        ) {
          continue;
        }

      } else if (
        users.length !== requiredTeamSize
      ) {
        continue;
      }

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

        try {

          await channel.send(
            `Rejected signup (duplicate player): ${team.users.map(
              u => `<@${u.id}>`
            ).join(" ")}`
          );

        } catch {}

        continue;
      }

      const teamSizeForTier =
        twoLobbies
          ? team.users.length
          : requiredTeamSize;

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

        blockReason = getSignupBlockReason(
          user.id,
          eventBanRows
        );

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

      return interaction.editReply(
        "No eligible signups found."
      );
    }

    let validTeams = [...eligibleTeams];
    let skippedBannedTeams = [];
    let includedDespiteBan = false;

    if (flaggedTeams.length > 0) {

      await interaction.editReply(
        `Scan complete. Found **${flaggedTeams.length}** team(s) with an active event ban. Choose an option below (only you can see this).`
      );

      const decision =
        await promptBannedTeamDecision(
          interaction,
          flaggedTeams
        );

      if (decision === "cancel") {

        return interaction.editReply(
          "Cancelled — no roles were assigned."
        );

      }

      if (decision === "include") {

        validTeams = [
          ...eligibleTeams,
          ...flaggedTeams.map(item => item.team)
        ];

        includedDespiteBan = true;

      } else {

        skippedBannedTeams = flaggedTeams;

        for (const { team, blockReason } of flaggedTeams) {

          try {

            await channel.send(
              `Skipped signup (event ban): ${team.users.map(
                u => `<@${u.id}>`
              ).join(" ")}\n${formatSignupBlockMessage(blockReason)}`
            );

          } catch {}

        }

      }

    }

    if (validTeams.length === 0) {

      return interaction.editReply(
        "No teams selected for role assignment."
      );
    }

    await finishRoletagged(interaction, {
      validTeams,
      skippedBannedTeams,
      includedDespiteBan,
      tierRejectedCount,
      role,
      isReload,
      requiredTeamSize,
      twoLobbies,
      channel,
      guild
    });

  }
};
