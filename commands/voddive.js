const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getAccessToken } = require("../twitchBatch");
const {
  findEventChannels,
  scanPostedChannelVods
} = require("../lib/vodEventScan");
const { postVodPublishReport } = require("../lib/vodPublishReport");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("voddive")
    .setDescription("Post VOD publish times for event window to mod log")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(o =>
      o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
    .addStringOption(o =>
      o.setName("start").setDescription("HH:MM UTC").setRequired(true))
    .addStringOption(o =>
      o.setName("end").setDescription("HH:MM UTC").setRequired(true)),

  async execute(interaction) {
    try {
      const category = interaction.channel.parent;

      if (!category) {
        return interaction.reply({
          content: "This command must be used inside a category.",
          ephemeral: true
        });
      }

      const { streamChannel } = findEventChannels(
        interaction.guild,
        category
      );

      if (!streamChannel) {
        return interaction.reply({
          content: "Could not locate twitch stream/links channel.",
          ephemeral: true
        });
      }

      await interaction.reply({
        content: "Scanning posted Twitch links...",
        ephemeral: true
      });

      const token = await getAccessToken();
      if (!token) throw new Error("Failed to get Twitch token");

      const date = interaction.options.getString("date");
      const startTime = interaction.options.getString("start");
      const endTime = interaction.options.getString("end");
      const start = new Date(`${date}T${startTime}:00Z`);
      const end = new Date(`${date}T${endTime}:00Z`);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error("Invalid date or time. Use YYYY-MM-DD and HH:MM UTC.");
      }

      const entries = await scanPostedChannelVods({
        streamChannel,
        token,
        start,
        end
      });

      await postVodPublishReport(interaction.client, {
        categoryName: category.name,
        date,
        startTime,
        endTime,
        entries
      });

      await interaction.followUp({
        content: "VOD publish report posted to mod log.",
        ephemeral: true
      });
    } catch (err) {
      console.error("VODDIVE ERROR:", err);

      const msg = err?.message || "Unknown error";

      if (!interaction.replied) {
        await interaction.reply({
          content: `Error: ${msg}`,
          ephemeral: true
        });
      } else {
        await interaction.followUp({
          content: `Error: ${msg}`,
          ephemeral: true
        });
      }
    }
  }
};
