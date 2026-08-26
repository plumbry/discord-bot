const { SlashCommandBuilder } = require("discord.js");

const {
  handlePostCommand,
  handleResendCommand,
  handleEndCommand,
  handleUnregisterCommand,
  handleSelectMenu,
  handleButton,
  autocompleteEndOrResend
} = require("../lib/lfgPostCommand");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lfg")
    .setDescription("Public event LFG matchmaking")
    .addSubcommand(sub =>
      sub
        .setName("post")
        .setDescription("Staff: post public event LFG in this channel")
    )
    .addSubcommand(sub =>
      sub
        .setName("resend")
        .setDescription("Staff: repost the active LFG message in this channel")
        .addStringOption(option =>
          option
            .setName("event")
            .setDescription("LFG post to resend (defaults to this channel)")
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("end")
        .setDescription("Staff: end the current LFG post and stop fill DMs")
        .addStringOption(option =>
          option
            .setName("event")
            .setDescription("LFG post to end (defaults to this channel)")
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("unregister")
        .setDescription("Stop your LFG fill / teammate interest")
    ),

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand(false);
    const focused = interaction.options.getFocused(true);

    if (
      (sub === "end" || sub === "resend") &&
      focused?.name === "event"
    ) {
      await autocompleteEndOrResend(interaction);
    }
  },

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: "Use this command in the ZBD server.",
        ephemeral: true
      });
    }

    const sub = interaction.options.getSubcommand();

    await interaction.deferReply({ ephemeral: true });

    if (sub === "post") {
      return handlePostCommand(interaction);
    }

    if (sub === "resend") {
      return handleResendCommand(interaction);
    }

    if (sub === "end") {
      return handleEndCommand(interaction);
    }

    if (sub === "unregister") {
      return handleUnregisterCommand(interaction);
    }
  },

  handleSelectMenu,
  handleButton
};
