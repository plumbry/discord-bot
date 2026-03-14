const { SlashCommandBuilder } = require("discord.js");

let yuniteRunning = false;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("yunite")
    .setDescription("Control Yunite stream")
    .addSubcommand(s =>
      s.setName("start").setDescription("Start Yunite stream"))
    .addSubcommand(s =>
      s.setName("stop").setDescription("Stop Yunite stream")),

  async execute(interaction) {

    const sub = interaction.options.getSubcommand();

    if (sub === "start") {

      if (yuniteRunning)
        return interaction.reply({ content: "Yunite already running.", ephemeral: true });

      yuniteRunning = true;

      startYuniteStream();

      return interaction.reply("✅ Yunite stream started.");

    }

    if (sub === "stop") {

      if (!yuniteRunning)
        return interaction.reply({ content: "Yunite is not running.", ephemeral: true });

      yuniteRunning = false;

      if (yuniteSocket) {
        yuniteSocket.terminate();
        yuniteSocket = null;
      }

      return interaction.reply("🛑 Yunite stream stopped.");

    }

  }
};
