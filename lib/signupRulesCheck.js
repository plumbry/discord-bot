const { getSheets } = require("./sheets");

const {
  findRulesAcknowledgementChannel,
  isTeamAcknowledged,
  loadRulesAcknowledgementMessages
} = require("./rulesAcknowledgement");

const { splitValidTeams } = require("./signupTeamScan");

const LOG_CHANNEL_ID = "1471082166535454780";
const SHEET_ID = process.env.MAIN_SHEET_ID;
const AUDIT_RANGE = "Audit Log!A:G";

const MODE_LABELS = {
  1: "Solo",
  2: "Duos",
  3: "Trios",
  4: "Squads"
};

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

async function sendRulesCheckReply(interaction, content) {
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
        "[CHECKRULES] Could not deliver command result:",
        followUpErr
      );
    }
  }
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

function collectRulesAckMissingLabels(
  teams,
  acknowledgementMessages,
  {
    teamLabel = "Team",
    startNumber = 1
  } = {}
) {
  if (acknowledgementMessages === null) {
    return [];
  }

  const missingLabels = [];
  let teamNumber = startNumber;

  for (const team of teams) {
    const acknowledged = isTeamAcknowledged(
      team.users.map(user => user.id),
      acknowledgementMessages
    );

    if (!acknowledged) {
      missingLabels.push(`${teamLabel} ${teamNumber}`);
    }

    teamNumber++;
  }

  return missingLabels;
}

async function finishSignupRulesCheck(
  interaction,
  {
    commandName,
    validTeams,
    skippedBannedTeams,
    includedDespiteBan,
    tierRejectedCount,
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

  const missingLabels = [];

  if (acknowledgementMessages !== null && validTeams.length > 0) {
    if (twoLobbies) {
      missingLabels.push(
        ...collectRulesAckMissingLabels(
          lobby1Teams,
          acknowledgementMessages,
          { teamLabel: "Lobby 1 Team" }
        ),
        ...collectRulesAckMissingLabels(
          lobby2Teams,
          acknowledgementMessages,
          { teamLabel: "Lobby 2 Team" }
        ),
        ...collectRulesAckMissingLabels(
          overflowTeams,
          acknowledgementMessages,
          { teamLabel: "Overflow Team" }
        )
      );
    } else {
      missingLabels.push(
        ...collectRulesAckMissingLabels(
          roledTeams,
          acknowledgementMessages,
          { teamLabel: "Team" }
        ),
        ...collectRulesAckMissingLabels(
          overflowTeams,
          acknowledgementMessages,
          { teamLabel: "Overflow Team" }
        )
      );
    }

    rulesAckNote = formatMissingRulesAckNote(missingLabels);
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

    (validTeams.length === 0
      ? "No eligible signups to check.\n"
      : "Rules acknowledgement check\n") +
      "Mode: " + (MODE_LABELS[requiredTeamSize] || requiredTeamSize) +
      (twoLobbies ? " (capacity per lobby)" : "") + "\n" +
      "Reload: " + (isReload ? "Yes" : "No") + "\n" +
    "Valid Teams: " + validTeams.length + "\n" +
    "Roled Teams: " + roledTeams.length + "\n" +
    "Overflow Teams: " + overflowTeams.length +
    lobbyNote +
    banNote +
    tierNote +
    rulesAckNote;

  try {

    const logChannel =
      await guild.channels.fetch(LOG_CHANNEL_ID);

    await logChannel.send(

      `Rules check via /${commandName}\n` +
      "Moderator: " +
      interaction.user.tag +
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
      tierNote +
      rulesAckNote
    );

  } catch {}

  try {

    await logAudit({

      action: "SIGNUP_RULES_CHECK",

      moderator: interaction.user,

      context:
        `command=${commandName} mode=${requiredTeamSize} reload=${isReload} ` +
        `two_lobbies=${twoLobbies} teams=${validTeams.length} ` +
        `included_banned=${includedDespiteBan} skipped_banned=${skippedBannedTeams.length}`
    });

  } catch (err) {

    console.error(err);

  }

  await sendRulesCheckReply(interaction, result);

}

module.exports = {
  finishSignupRulesCheck,
  sendRulesCheckReply
};
