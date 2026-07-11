const { SlashCommandBuilder } = require("discord.js");

let yuniteRunning = false;

module.exports = {
  decommissioned: true,
  data: new SlashCommandBuilder()
    .setName("yunite")
    .setDescription("Control Yunite stream")
    .addSubcommand(s =>
      s.setName("start").setDescription("Start Yunite stream"))
    .addSubcommand(s =>
      s.setName("stop").setDescription("Stop Yunite stream")),

  async execute(interaction) {

    const sub = interaction.options.getSubcommand();

    const bot = interaction.client;

    if (sub === "start") {

      if (yuniteRunning)
        return interaction.reply({
          content: "Yunite already running.",
          ephemeral: true
        });

      yuniteRunning = true;

      if (bot.startYuniteStream) {
        bot.startYuniteStream();
      }

      return interaction.reply({
        content: "✅ Yunite stream started.",
        ephemeral: true
      });

    }

    if (sub === "stop") {

      if (!yuniteRunning)
        return interaction.reply({
          content: "Yunite is not running.",
          ephemeral: true
        });

      yuniteRunning = false;

      if (bot.yuniteSocket) {
        bot.yuniteSocket.terminate();
        bot.yuniteSocket = null;
      }

      return interaction.reply({
        content: "🛑 Yunite stream stopped.",
        ephemeral: true
      });

    }

  }
};
