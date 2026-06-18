const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { getSheets } = require("../lib/sheets");
const {
  findSignupMatchesByTeamNumber,
  scanSignupTeams
} = require("../lib/signupTeamScan");

// ================= CONSTANTS =================
const LOG_CHANNEL_ID = "1471082166535454780";
const SHEET_ID = process.env.MAIN_SHEET_ID;
const AUDIT_RANGE = "Audit Log!A:G";

const ROLE_BATCH_SIZE = 5;
const ROLE_BATCH_DELAY_MS = 200;

// ================= HELPERS =================
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const isoNow = () => new Date().toISOString();

async function sendDisqualifyReply(interaction, content) {
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
        "[DISQUALIFY] Could not deliver command result:",
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

function parsePlayersInput(playersValue, guild) {
  if (!playersValue) {
    return [];
  }

  const ids = new Set();
  const mentionRegex = /<@!?(\d{17,20})>/g;
  let match;

  while ((match = mentionRegex.exec(playersValue)) !== null) {
    ids.add(match[1]);
  }

  for (const part of playersValue.split(/[\s,]+/)) {
    const trimmed = part.trim();

    if (/^\d{17,20}$/.test(trimmed)) {
      ids.add(trimmed);
    }
  }

  return [...ids].map(id => {
    const member = guild.members.cache.get(id);
    const user = member?.user || guild.client.users.cache.get(id);

    return {
      id,
      tag: user?.tag || id,
      member
    };
  });
}

async function removeRolesInBatches(guild, userIds, role) {
  const removed = [];
  const failed = [];
  const skipped = [];
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
          failed.push({
            id: userId,
            reason: "member not found"
          });
          return;
        }

        if (!member.roles.cache.has(role.id)) {
          skipped.push({
            id: userId,
            tag: member.user.tag
          });
          return;
        }

        try {
          await member.roles.remove(role);
          removed.push({
            id: userId,
            tag: member.user.tag
          });
        } catch (err) {
          failed.push({
            id: userId,
            tag: member.user.tag,
            reason: err?.message || "remove failed"
          });
        }
      })
    );

    if (i + ROLE_BATCH_SIZE < ids.length) {
      await delay(ROLE_BATCH_DELAY_MS);
    }
  }

  return { removed, failed, skipped };
}

function formatPlayerList(entries) {
  if (!entries.length) {
    return "None";
  }

  return entries
    .map(entry => `<@${entry.id}>`)
    .join(" ");
}

function formatRoleResult(removed, skipped) {
  const lines = [];

  if (removed.length) {
    lines.push(
      "Role removed: " +
      removed.map(entry => `<@${entry.id}>`).join(" ")
    );
  }

  if (skipped.length) {
    lines.push(
      "Did not have role: " +
      skipped.map(entry => `<@${entry.id}>`).join(" ")
    );
  }

  return lines.join("\n");
}

function formatDisqualifiedMessage(disqualifiedPlayers, reason) {
  return (
    disqualifiedPlayers.map(player => `<@${player.id}>`).join(" x ") +
    " - you have been disqualified from today's event for " +
    reason.trim() +
    ". Please #create-ticket to discuss further with the moderation team."
  );
}

async function isValidSignupTeam(channel, guild, team) {
  const teamSize = team.users.length;
  const scanConfigs = [
    {
      requiredTeamSize: teamSize,
      twoLobbies: false,
      includeBanned: true
    },
    {
      requiredTeamSize: teamSize,
      twoLobbies: true,
      includeBanned: true
    }
  ];

  for (const scanConfig of scanConfigs) {
    const scanResult = await scanSignupTeams(
      channel,
      guild,
      scanConfig
    );

    if (
      scanResult.validTeams.some(
        validTeam => validTeam.message.id === team.message.id
      )
    ) {
      return true;
    }
  }

  return false;
}

async function logDisqualify({
  moderator,
  guild,
  teamNumber,
  teamUsers,
  disqualifiedPlayers,
  role,
  reason,
  signupMessageId,
  deletionSucceeded,
  failures,
  roleRemoved,
  roleFailed,
  notificationSent
}) {
  const teamPlayerTags =
    teamUsers.map(u => u.tag || u.id).join(", ");
  const disqualifiedTags =
    disqualifiedPlayers.map(u => u.tag || u.id).join(", ");
  const failureSummary =
    failures.length ? failures.join("; ") : "none";

  console.log(
    "[DISQUALIFY] " +
    `moderator=${moderator.tag} (${moderator.id}) ` +
    `team_number=${teamNumber} ` +
    `team_players=[${teamPlayerTags}] ` +
    `disqualified=[${disqualifiedTags}] ` +
    `role=${role.name} (${role.id}) ` +
    `reason=${reason} ` +
    `signup_message_id=${signupMessageId} ` +
    `deletion_succeeded=${deletionSucceeded} ` +
    `role_removed=${roleRemoved.length} role_failed=${roleFailed.length} ` +
    `notification_sent=${notificationSent} ` +
    `failures=${failureSummary}`
  );

  try {
    const logChannel =
      await guild.channels.fetch(LOG_CHANNEL_ID);

    await logChannel.send(
      "Sign-up disqualified via /disqualify\n" +
      "Moderator: " + moderator.tag + "\n" +
      "Team number: " + teamNumber + "\n" +
      "Team players: " + teamPlayerTags + "\n" +
      "Disqualified: " + disqualifiedTags + "\n" +
      "Role removed: " + role.name + "\n" +
      "Reason: " + reason + "\n" +
      "Sign-up message ID: " + signupMessageId + "\n" +
      "Deletion succeeded: " + (deletionSucceeded ? "Yes" : "No") + "\n" +
      "Disqualification notification sent: " + (notificationSent ? "Yes" : "No") + "\n" +
      "Failures: " + failureSummary
    );
  } catch (err) {
    console.error("[DISQUALIFY] Log channel write failed:", err);
  }

  try {
    await logAudit({
      action: "ROLE_DISQUALIFY",
      moderator,
      context:
        `team_number=${teamNumber} role=${role.id} ` +
        `signup_message_id=${signupMessageId} deletion=${deletionSucceeded} ` +
        `disqualified=${disqualifiedTags} role_removed=${roleRemoved.length} ` +
        `role_failed=${roleFailed.length} notification_sent=${notificationSent} ` +
        `reason=${reason} failures=${failureSummary}`
    });
  } catch (err) {
    console.error("[DISQUALIFY AUDIT ERROR]", err);
  }
}

async function runDisqualifyTeam({
  channel,
  guild,
  teamNumber,
  role,
  playersValue,
  reason,
  moderator
}) {
  if (!process.env.MAIN_SHEET_ID) {
    return "MAIN_SHEET_ID not configured.";
  }

  if (!playersValue?.trim()) {
    return "No changes were made. Select at least one player to disqualify.";
  }

  if (!reason?.trim()) {
    return "No changes were made. Add a reason for the disqualification.";
  }

  if (role.managed) {
    return "This role is managed and cannot be removed.";
  }

  const botMember = await guild.members.fetchMe();

  if (role.position >= botMember.roles.highest.position) {
    return "I cannot remove this role due to role hierarchy.";
  }

  let matches;

  try {
    matches = await findSignupMatchesByTeamNumber(
      channel,
      teamNumber
    );
  } catch (err) {
    console.error("[DISQUALIFY] Signup lookup failed:", err);
    return "Could not scan signups. Try again later.";
  }

  if (matches.length === 0) {
    return `Team number **${teamNumber}** does not exist among valid signups.`;
  }

  if (matches.length > 1) {
    const details = matches.map(entry => {
      const label = entry.asOverflow ? "Overflow" : "Main";
      return `${label} - ${entry.team.users.map(u => `<@${u.id}>`).join(" ")}`;
    }).join("\n");

    return `Team number **${teamNumber}** matches multiple signups:\n${details}`;
  }

  const team = matches[0].team;

  let isValid;

  try {
    isValid = await isValidSignupTeam(
      channel,
      guild,
      team
    );
  } catch (err) {
    if (err?.code === "EVENT_BAN_SHEET") {
      console.error("[DISQUALIFY] Event ban sheet read failed:", err);
      return "Could not load Event Bans sheet. Try again later.";
    }

    console.error("[DISQUALIFY] Signup validation failed:", err);
    return "Could not validate signup. Try again later.";
  }

  if (!isValid) {
    return `Team number **${teamNumber}** does not correspond to a valid signup.`;
  }

  const teamUserIds = new Set(team.users.map(u => u.id));
  const parsedPlayers = parsePlayersInput(playersValue, guild);

  if (!parsedPlayers.length) {
    return "No changes were made. Select at least one player to disqualify.";
  }

  const invalidPlayers = parsedPlayers.filter(
    player => !teamUserIds.has(player.id)
  );

  if (invalidPlayers.length) {
    return (
      "No changes were made. These selected players are not on team " +
      teamNumber + ": " +
      invalidPlayers.map(player => `<@${player.id}>`).join(" ")
    );
  }

  const disqualifiedPlayers = parsedPlayers.map(player => ({
    id: player.id,
    tag: player.tag
  }));

  const failures = [];
  const { removed, failed, skipped } =
    await removeRolesInBatches(
      guild,
      team.users.map(user => user.id),
      role
    );

  if (failed.length) {
    failures.push(
      "Role removal failed for: " +
      failed.map(entry =>
        `<@${entry.id}> (${entry.reason || "unknown error"})`
      ).join(", ")
    );
  }

  let deletionSucceeded = false;

  try {
    await team.message.delete();
    deletionSucceeded = true;
  } catch (err) {
    failures.push(
      "Sign-up message deletion failed: " +
      (err?.message || "unknown error")
    );
    console.error("[DISQUALIFY] Sign-up message deletion failed:", err);
  }

  const disqualifiedMessage =
    formatDisqualifiedMessage(disqualifiedPlayers, reason);
  let notificationSent = false;

  try {
    await channel.send(disqualifiedMessage);
    notificationSent = true;
  } catch (err) {
    failures.push(
      "Disqualification notification failed: " +
      (err?.message || "unknown error")
    );
    console.error("[DISQUALIFY] Disqualification notification failed:", err);
  }

  const resultLines = [
    "**Disqualification complete**",
    "Team number: " + teamNumber,
    formatRoleResult(removed, skipped),
    "Sign-up deleted: " + (deletionSucceeded ? "Yes" : "No"),
    "Disqualified player(s): " + formatPlayerList(disqualifiedPlayers),
    "Notification sent: " + (notificationSent ? "Yes" : "No")
  ];

  if (failures.length) {
    resultLines.push(
      "",
      "**Partial failures:**",
      ...failures
    );
  }

  await logDisqualify({
    moderator,
    guild,
    teamNumber,
    teamUsers: team.users,
    disqualifiedPlayers,
    role,
    reason: reason.trim(),
    signupMessageId: team.message.id,
    deletionSucceeded,
    failures,
    roleRemoved: removed,
    roleFailed: failed,
    notificationSent
  });

  return resultLines.join("\n");
}

// ================= COMMAND =================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("disqualify")
    .setDescription("Disqualify selected player(s) from a valid sign-up")

    .addIntegerOption(o =>
      o.setName("team_number")
        .setDescription("Team number from signup reactions")
        .setRequired(true)
        .setMinValue(1)
    )

    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Event role to remove from every player on the team")
        .setRequired(true)
    )

    .addStringOption(o =>
      o.setName("players")
        .setDescription("Player(s) being disqualified (mentions or user IDs)")
        .setRequired(true)
    )

    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason shown to the disqualified player(s)")
        .setRequired(true)
        .setMaxLength(1000)
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageRoles
    ),

  async execute(interaction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    const teamNumber =
      interaction.options.getInteger("team_number");
    const role =
      interaction.options.getRole("role");
    const playersValue =
      interaction.options.getString("players");
    const reason =
      interaction.options.getString("reason");

    const channel = interaction.channel;
    const guild = interaction.guild;

    await sendDisqualifyReply(
      interaction,
      `Processing disqualification for team **${teamNumber}**...`
    );

    const result = await runDisqualifyTeam({
      channel,
      guild,
      teamNumber,
      role,
      playersValue,
      reason,
      moderator: interaction.user
    });

    await sendDisqualifyReply(interaction, result);
  }
};

module.exports.runDisqualifyTeam = runDisqualifyTeam;
