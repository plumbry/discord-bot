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

const NOTIFY_MESSAGE =
  "Your teammate(s) have unregistered. Your sign up has been deleted. " +
  "You are welcome to re-register with new teammates!";

// ================= HELPERS =================
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const isoNow = () => new Date().toISOString();

async function sendUnregReply(interaction, content) {
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
        "[UNREG] Could not deliver command result:",
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

function formatRemovedPlayers(removed, skipped) {
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

async function logUnreg({
  interaction,
  guild,
  teamNumber,
  teamUsers,
  unregisteringPlayers,
  remainingTeammates,
  role,
  notifyMode,
  signupMessageId,
  deletionSucceeded,
  failures,
  roleRemoved,
  roleFailed,
  notificationSent
}) {
  const teamPlayerTags =
    teamUsers.map(u => u.tag || u.id).join(", ");
  const unregisteringTags =
    unregisteringPlayers.length
      ? unregisteringPlayers.map(u => u.tag || u.id).join(", ")
      : "whole team";
  const remainingTags =
    remainingTeammates.length
      ? remainingTeammates.map(u => u.tag || u.id).join(", ")
      : "none";
  const failureSummary =
    failures.length ? failures.join("; ") : "none";

  console.log(
    "[UNREG] " +
    `moderator=${interaction.user.tag} (${interaction.user.id}) ` +
    `team_number=${teamNumber} ` +
    `team_players=[${teamPlayerTags}] ` +
    `unregistering=[${unregisteringTags}] ` +
    `remaining=[${remainingTags}] ` +
    `role=${role.name} (${role.id}) ` +
    `notify=${notifyMode} ` +
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
      "Sign-up unregistered via /unreg\n" +
      "Moderator: " + interaction.user.tag + "\n" +
      "Team number: " + teamNumber + "\n" +
      "Team players: " + teamPlayerTags + "\n" +
      "Unregistering: " + unregisteringTags + "\n" +
      "Remaining teammates: " + remainingTags + "\n" +
      "Role removed: " + role.name + "\n" +
      "Notify mode: " + notifyMode + "\n" +
      "Sign-up message ID: " + signupMessageId + "\n" +
      "Deletion succeeded: " + (deletionSucceeded ? "Yes" : "No") + "\n" +
      "Teammate notification sent: " + (notificationSent ? "Yes" : "No") + "\n" +
      "Failures: " + failureSummary
    );
  } catch (err) {
    console.error("[UNREG] Log channel write failed:", err);
  }

  try {
    await logAudit({
      action: "ROLE_UNREG",
      moderator: interaction.user,
      context:
        `team_number=${teamNumber} role=${role.id} notify=${notifyMode} ` +
        `signup_message_id=${signupMessageId} deletion=${deletionSucceeded} ` +
        `unregistering=${unregisteringTags} remaining=${remainingTags} ` +
        `role_removed=${roleRemoved.length} role_failed=${roleFailed.length} ` +
        `notification_sent=${notificationSent} failures=${failureSummary}`
    });
  } catch (err) {
    console.error("[UNREG AUDIT ERROR]", err);
  }
}

// ================= COMMAND =================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("unreg")
    .setDescription("Unregister a valid sign-up by team number")

    .addIntegerOption(o =>
      o.setName("team_number")
        .setDescription("Team number from signup reactions")
        .setRequired(true)
        .setMinValue(1)
    )

    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to remove from every player on the team")
        .setRequired(true)
    )

    .addStringOption(o =>
      o.setName("players")
        .setDescription(
          "Teammate(s) who unregistered (mentions or user IDs). Omit for whole team."
        )
        .setRequired(false)
    )

    .addStringOption(o =>
      o.setName("notify")
        .setDescription("Whether to notify remaining teammates")
        .setRequired(true)
        .addChoices(
          { name: "silent", value: "silent" },
          { name: "tag_remaining", value: "tag_remaining" }
        )
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageRoles
    ),

  async execute(interaction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    if (!process.env.MAIN_SHEET_ID) {
      return sendUnregReply(
        interaction,
        "MAIN_SHEET_ID not configured."
      );
    }

    const teamNumber =
      interaction.options.getInteger("team_number");
    const role =
      interaction.options.getRole("role");
    const playersValue =
      interaction.options.getString("players");
    const notifyMode =
      interaction.options.getString("notify");

    const channel = interaction.channel;
    const guild = interaction.guild;

    if (role.managed) {
      return sendUnregReply(
        interaction,
        "This role is managed and cannot be removed."
      );
    }

    const botMember = await guild.members.fetchMe();

    if (role.position >= botMember.roles.highest.position) {
      return sendUnregReply(
        interaction,
        "I cannot remove this role due to role hierarchy."
      );
    }

    let matches;

    try {
      matches = await findSignupMatchesByTeamNumber(
        channel,
        teamNumber
      );
    } catch (err) {
      console.error("[UNREG] Signup lookup failed:", err);
      return sendUnregReply(
        interaction,
        "Could not scan signups. Try again later."
      );
    }

    if (matches.length === 0) {
      return sendUnregReply(
        interaction,
        `Team number **${teamNumber}** does not exist among valid signups.`
      );
    }

    if (matches.length > 1) {
      const details = matches.map(entry => {
        const label = entry.asOverflow ? "Overflow" : "Main";
        return `${label} — ${entry.team.users.map(u => `<@${u.id}>`).join(" ")}`;
      }).join("\n");

      return sendUnregReply(
        interaction,
        `Team number **${teamNumber}** matches multiple signups:\n${details}`
      );
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
        console.error("[UNREG] Event ban sheet read failed:", err);
        return sendUnregReply(
          interaction,
          "Could not load Event Bans sheet. Try again later."
        );
      }

      console.error("[UNREG] Signup validation failed:", err);
      return sendUnregReply(
        interaction,
        "Could not validate signup. Try again later."
      );
    }

    if (!isValid) {
      return sendUnregReply(
        interaction,
        `Team number **${teamNumber}** does not correspond to a valid signup.`
      );
    }

    const teamUserIds = new Set(team.users.map(u => u.id));
    const parsedPlayers = parsePlayersInput(playersValue, guild);

    if (parsedPlayers.length) {
      const invalidPlayers = parsedPlayers.filter(
        player => !teamUserIds.has(player.id)
      );

      if (invalidPlayers.length) {
        return sendUnregReply(
          interaction,
          "No changes were made. These selected players are not on team " +
          teamNumber + ": " +
          invalidPlayers.map(player => `<@${player.id}>`).join(" ")
        );
      }
    }

    const unregisteringPlayers = parsedPlayers.length
      ? parsedPlayers.map(player => ({
        id: player.id,
        tag: player.tag
      }))
      : team.users.map(user => ({
        id: user.id,
        tag: user.tag
      }));

    const unregisteringIds = new Set(
      unregisteringPlayers.map(player => player.id)
    );
    const remainingTeammates = team.users
      .filter(user => !unregisteringIds.has(user.id))
      .map(user => ({
        id: user.id,
        tag: user.tag
      }));

    await sendUnregReply(
      interaction,
      `Processing unregister for team **${teamNumber}**…`
    );

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
      console.error("[UNREG] Sign-up message deletion failed:", err);
    }

    let notificationSent = false;

    if (
      notifyMode === "tag_remaining" &&
      remainingTeammates.length > 0
    ) {
      try {
        await channel.send(
          remainingTeammates
            .map(teammate => `<@${teammate.id}>`)
            .join(" ") +
          " " +
          NOTIFY_MESSAGE
        );
        notificationSent = true;
      } catch (err) {
        failures.push(
          "Teammate notification failed: " +
          (err?.message || "unknown error")
        );
        console.error("[UNREG] Teammate notification failed:", err);
      }
    }

    const resultLines = [
      "**Unregister complete**",
      "Team number: " + teamNumber,
      formatRemovedPlayers(removed, skipped),
      "Sign-up deleted: " + (deletionSucceeded ? "Yes" : "No"),
      "Unregistering player(s): " + formatPlayerList(unregisteringPlayers),
      "Remaining teammate(s): " + formatPlayerList(remainingTeammates),
      "Teammate notifications sent: " + (notificationSent ? "Yes" : "No")
    ];

    if (failures.length) {
      resultLines.push(
        "",
        "**Partial failures:**",
        ...failures
      );
    }

    await sendUnregReply(interaction, resultLines.join("\n"));

    await logUnreg({
      interaction,
      guild,
      teamNumber,
      teamUsers: team.users,
      unregisteringPlayers,
      remainingTeammates,
      role,
      notifyMode,
      signupMessageId: team.message.id,
      deletionSucceeded,
      failures,
      roleRemoved: removed,
      roleFailed: failed,
      notificationSent
    });
  }
};
