const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const {
  buildFlaggedTeamLookup,
  resolveValidTeamsInSignupOrder,
  scanSignupTeams
} = require("../lib/signupTeamScan");

const {
  finishSignupRulesCheck,
  sendRulesCheckReply
} = require("../lib/signupRulesCheck");

const {
  handleSignupBanButton,
  promptBannedTeamDecision
} = require("../lib/signupRoleFinish");

const COMMAND_NAME = "checkrules";

module.exports = {
  data: new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription(
      "Check rules acknowledgement for signups in this channel"
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
      return sendRulesCheckReply(interaction, {
        content: "MAIN_SHEET_ID not configured."
      });
    }

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

    let scanResult;

    try {
      scanResult = await scanSignupTeams(
        channel,
        guild,
        {
          requiredTeamSize,
          twoLobbies,
          postRejections: true
        }
      );
    } catch (err) {
      if (err?.code === "EVENT_BAN_SHEET") {
        console.error("[CHECKRULES] Event ban sheet read failed:", err);
        return sendRulesCheckReply(
          interaction,
          "Could not load Event Bans sheet. Try again later."
        );
      }

      throw err;
    }

    const {
      eligibleTeams,
      flaggedTeams,
      candidateTeams,
      tierRejectedCount
    } = scanResult;

    const finishOptions = {
      commandName: COMMAND_NAME,
      tierRejectedCount,
      isReload,
      requiredTeamSize,
      twoLobbies,
      channel,
      guild
    };

    if (
      eligibleTeams.length === 0 &&
      flaggedTeams.length === 0
    ) {
      return finishSignupRulesCheck(interaction, {
        ...finishOptions,
        validTeams: [],
        skippedBannedTeams: [],
        includedDespiteBan: false
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
      await sendRulesCheckReply(
        interaction,
        `Scan complete. Found **${flaggedTeams.length}** team(s) with an active event ban. Choose an option below (only you can see this).`
      );

      const decision = await promptBannedTeamDecision(
        interaction,
        flaggedTeams,
        {
          commandName: COMMAND_NAME,
          rerunLabel: "/checkrules"
        }
      );

      if (decision === "cancel") {
        return sendRulesCheckReply(
          interaction,
          "Cancelled — no rules check performed."
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
      }
    }

    await sendRulesCheckReply(
      interaction,
      "Checking rules acknowledgement…"
    );

    return finishSignupRulesCheck(interaction, {
      ...finishOptions,
      validTeams,
      skippedBannedTeams,
      includedDespiteBan
    });
  },

  async handleButton(interaction) {
    return handleSignupBanButton(interaction, {
      commandName: COMMAND_NAME,
      rerunLabel: "/checkrules"
    });
  }
};
