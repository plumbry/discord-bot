const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getSheets } = require("../lib/sheets");
const { getAccessToken } = require("../twitchBatch");
const { findEventChannels, scanPostedChannelVods } = require("../lib/vodEventScan");

const SPREADSHEET_ID = process.env.MAIN_SHEET_ID;
const SHEET_NAME = "'VOD Report'";

async function appendRows(rows) {
  await getSheets().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vodreport")
    .setDescription("Check Twitch VOD compliance for event")
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

      await interaction.reply("Scanning posted Twitch links...");

      const token = await getAccessToken();
      if (!token) throw new Error("Failed to get Twitch token");

      const date = interaction.options.getString("date");
      const start = new Date(`${date}T${interaction.options.getString("start")}:00Z`);
      const end = new Date(`${date}T${interaction.options.getString("end")}:00Z`);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error("Invalid date or time. Use YYYY-MM-DD and HH:MM UTC.");
      }

      const results = await scanPostedChannelVods({
        streamChannel,
        token,
        start,
        end
      });

      const rows = [];
      const missing = [];

      for (const r of results) {
        if (!r.valid) missing.push(r.twitch);

        rows.push([
          category.name,
          "",
          r.twitch,
          r.lastStream,
          r.vodStart,
          r.vodEnd,
          r.valid ? "YES" : "NO",
          r.note,
          new Date().toISOString(),
          `<@${interaction.user.id}>`
        ]);
      }

      await appendRows(rows);

      let summary = `VOD Report Complete\n\n`;

      if (!results.length) {
        summary += "No Twitch channel links posted.";
      } else if (missing.length) {
        summary += `Issues Found (${missing.length})\n${missing.join("\n")}`;
      } else {
        summary += "All posted channels have valid VODs.";
      }

      await interaction.followUp(summary);
    } catch (err) {
      console.error("VODREPORT ERROR:", err);

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
