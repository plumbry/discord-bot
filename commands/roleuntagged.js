const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

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
  MESSAGE_SCAN_LIMIT,
  TEAM_LIMITS,
  buildFlaggedTeamLookup,
  resolveValidTeamsInSignupOrder
} = require("../lib/signupTeamScan");

const {
  createNameResolveSession,
  formatUnresolvedSignupMessage,
  messageHasMentions,
  messageHasValidUntaggedFormat,
  resolveUntaggedTeamsFromMessage,
  syncInvalidUntaggedSignupReactions
} = require("../lib/untaggedSignupScan");

const {
  clearSkippedBannedSignupReactions,
  finishSignupRoleAssignment,
  handleSignupBanButton,
  promptBannedTeamDecision,
  sendCommandReply
} = require("../lib/signupRoleFinish");

const COMMAND_NAME = "roleuntagged";

module.exports = {
  data: new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription(
      "Give roles from a bulk untagged signup list (one message, one team per line)"
    )

    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Role to give")
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Team size")
        .setRequired(true)
        .addChoices(
          { name: "Solos (no tier check)", value: "1" },
          { name: "Duos", value: "2" },
          { name: "Trios", value: "3" },
          { name: "Squads", value: "4" }
        )
    )

    .addBooleanOption(option =>
      option
        .setName("reload")
        .setDescription("Reload mode (reduced team limits)")
        .setRequired(false)
    )

    .addBooleanOption(option =>
      option
        .setName("two_lobbies")
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
      return sendCommandReply(interaction, {
        content: "MAIN_SHEET_ID not configured."
      });
    }

    const role = interaction.options.getRole("role");
    const isReload =
      interaction.options.getBoolean("reload") || false;
    const twoLobbies =
      interaction.options.getBoolean("two_lobbies") || false;
    const requiredTeamSize = parseInt(
      interaction.options.getString("mode"),
      10
    );

    const channel = interaction.channel;
    const guild = interaction.guild;

    let eventBanRows = [];

    try {
      eventBanRows = await getRows();
    } catch (err) {
      console.error("[ROLEUNTAGGED] Event ban sheet read failed:", err);
      return sendCommandReply(
        interaction,
        "Could not load Event Bans sheet. Try again later."
      );
    }

    const sessionCache = createNameResolveSession();

    const messages = await channel.messages.fetch({
      limit: MESSAGE_SCAN_LIMIT
    });

    const orderedMessages = [...messages.values()].reverse();

    const invalidSignupsMarked =
      await syncInvalidUntaggedSignupReactions(
        orderedMessages,
        requiredTeamSize,
        guild,
        sessionCache
      );

    const candidateTeams = [];
    const playerSignupMap = new Map();
    let unresolvedRejectedCount = 0;

    for (const msg of orderedMessages) {
      if (msg.author.bot || messageHasMentions(msg)) {
        continue;
      }

      if (
        !messageHasValidUntaggedFormat(
          msg,
          requiredTeamSize
        )
      ) {
        continue;
      }

      const {
        teams,
        failures,
        invalidLines
      } = await resolveUntaggedTeamsFromMessage(
        msg,
        requiredTeamSize,
        guild,
        sessionCache
      );

      unresolvedRejectedCount += failures.length + invalidLines.length;

      for (const failure of failures) {
        const notice = formatUnresolvedSignupMessage(failure);

        if (notice) {
          try {
            await channel.send(notice);
          } catch {}
        }
      }

      for (const team of teams) {
        candidateTeams.push({
          message: msg,
          users: team.users,
          lineIndex: team.lineIndex,
          line: team.line,
          signupKey: team.signupKey
        });

        for (const user of team.users) {
          if (!playerSignupMap.has(user.id)) {
            playerSignupMap.set(user.id, []);
          }

          playerSignupMap.get(user.id).push(team.signupKey);
        }
      }
    }

    const duplicatePlayers = new Set();

    for (const [id, signups] of playerSignupMap) {
      if (signups.length > 1) {
        duplicatePlayers.add(id);
      }
    }

    const eligibleTeams = [];
    const flaggedTeams = [];
    let tierRejectedCount = 0;

    for (const team of candidateTeams) {
      const hasDuplicate =
        team.users.some(u => duplicatePlayers.has(u.id));

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
        const tierCheck = await validateTeamTierCombo(
          guild,
          team.users,
          requiredTeamSize
        );

        if (!tierCheck.ok) {
          tierRejectedCount++;

          try {
            await channel.send(
              formatInvalidTierSignupMessage({
                users: team.users,
                tiers: tierCheck.tiers,
                teamSize: requiredTeamSize,
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

    const unresolvedNote =
      unresolvedRejectedCount > 0
        ? `\nUnresolved names rejected: ${unresolvedRejectedCount}`
        : "";

    if (
      eligibleTeams.length === 0 &&
      flaggedTeams.length === 0
    ) {
      await sendCommandReply(
        interaction,
        "Processing signup cleanup…"
      );

      return finishSignupRoleAssignment(interaction, {
        commandName: COMMAND_NAME,
        auditAction: "ROLE_UNTAGGED_ASSIGN",
        logTitle: "Role Assigned via /roleuntagged",
        validTeams: [],
        skippedBannedTeams: [],
        includedDespiteBan: false,
        tierRejectedCount,
        invalidSignupsMarked,
        scannedMessages: orderedMessages,
        emptyResultLabel: "No eligible untagged signups found in list messages.",
        role,
        isReload,
        requiredTeamSize,
        twoLobbies,
        channel,
        guild,
        teamLimits: TEAM_LIMITS,
        extraNotes: unresolvedNote,
        skipSignupReactions: true
      });
    }

    const eligibleTeamKeys = new Set(
      eligibleTeams.map(team => team.signupKey)
    );
    const flaggedByKey =
      buildFlaggedTeamLookup(flaggedTeams);

    let validTeams = [...eligibleTeams];
    let skippedBannedTeams = [];
    let includedDespiteBan = false;

    if (flaggedTeams.length > 0) {
      await sendCommandReply(
        interaction,
        `Scan complete. Found **${flaggedTeams.length}** team(s) with an active event ban. Choose an option below (only you can see this).`
      );

      const decision = await promptBannedTeamDecision(
        interaction,
        flaggedTeams,
        {
          commandName: COMMAND_NAME,
          rerunLabel: "/roleuntagged"
        }
      );

      if (decision === "cancel") {
        return sendCommandReply(
          interaction,
          "Cancelled — no roles were assigned."
        );
      }

      const includeBanned = decision === "include";

      ({ validTeams, skippedBannedTeams } =
        resolveValidTeamsInSignupOrder(
          candidateTeams,
          eligibleTeamKeys,
          flaggedByKey,
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

    await sendCommandReply(
      interaction,
      validTeams.length === 0
        ? "Processing signup cleanup…"
        : "Processing role assignment and signup reactions…"
    );

    await finishSignupRoleAssignment(interaction, {
      commandName: COMMAND_NAME,
      auditAction: "ROLE_UNTAGGED_ASSIGN",
      logTitle: "Role Assigned via /roleuntagged",
      validTeams,
      skippedBannedTeams,
      includedDespiteBan,
      tierRejectedCount,
      invalidSignupsMarked,
      scannedMessages: orderedMessages,
      role,
      isReload,
      requiredTeamSize,
      twoLobbies,
      channel,
      guild,
      teamLimits: TEAM_LIMITS,
      extraNotes: unresolvedNote,
      skipSignupReactions: true
    });
  },

  async handleButton(interaction) {
    return handleSignupBanButton(interaction, {
      commandName: COMMAND_NAME,
      rerunLabel: "/roleuntagged"
    });
  }
};
