const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder
} = require("discord.js");

const {
  scanChannelTeams,
  buildTeamNamesReport,
  splitDiscordMessages
} = require("../lib/teamSignupResolve");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("teamnames")
    .setDescription(
      "List Discord usernames for all signups in this channel (tagged or plain names)"
    )

    .addStringOption(option =>
      option
        .setName("mode")
        .setDescription("Team size to match signups against")
        .setRequired(true)
        .addChoices(
          { name: "Solos", value: "1" },
          { name: "Duos", value: "2" },
          { name: "Trios", value: "3" },
          { name: "Squads", value: "4" }
        )
    )

    .addBooleanOption(option =>
      option
        .setName("file")
        .setDescription("Attach results as a .txt file (useful for long lists)")
        .setRequired(false)
    )

    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const requiredTeamSize = parseInt(
      interaction.options.getString("mode"),
      10
    );
    const attachFile =
      interaction.options.getBoolean("file") || false;

    await interaction.deferReply({ ephemeral: true });

    const { teams, unresolved, modeLabel } =
      await scanChannelTeams(
        interaction.channel,
        interaction.guild,
        requiredTeamSize
      );

    const report = buildTeamNamesReport({
      teams,
      unresolved,
      modeLabel,
      channel: interaction.channel
    });

    if (attachFile) {
      const buffer = Buffer.from(report, "utf8");
      const attachment = new AttachmentBuilder(buffer, {
        name: "teamnames.txt"
      });

      return interaction.editReply({
        content:
          `Resolved **${teams.length}** team(s)` +
          (unresolved.length
            ? ` (${unresolved.length} signup(s) could not be resolved)`
            : "") +
          ".",
        files: [attachment]
      });
    }

    const chunks = splitDiscordMessages(report);

    await interaction.editReply({ content: chunks[0] });

    for (let index = 1; index < chunks.length; index++) {
      await interaction.followUp({
        content: chunks[index],
        ephemeral: true
      });
    }
  }
};
