const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getSheets } = require("../lib/sheets");
const { getAccessToken } = require("../twitchBatch");
const { scanChannelVods } = require("../lib/vodEventScan");

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
    .setName("vodcheck")
    .setDescription("Check Twitch VODs for usernames posted in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(o =>
      o.setName("date").setDescription("YYYY-MM-DD").setRequired(true))
    .addStringOption(o =>
      o.setName("start").setDescription("HH:MM UTC").setRequired(true))
    .addStringOption(o =>
      o.setName("end").setDescription("HH:MM UTC").setRequired(true)),

  async execute(interaction) {
    try {
      const categoryName =
        interaction.channel.parent?.name || interaction.channel.name;

      await interaction.reply(
        "Scanning Twitch usernames in this channel..."
      );

      const token = await getAccessToken();
      if (!token) throw new Error("Failed to get Twitch token");

      const date = interaction.options.getString("date");
      const start = new Date(`${date}T${interaction.options.getString("start")}:00Z`);
      const end = new Date(`${date}T${interaction.options.getString("end")}:00Z`);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error("Invalid date or time. Use YYYY-MM-DD and HH:MM UTC.");
      }

      const results = await scanChannelVods({
        channel: interaction.channel,
        token,
        start,
        end
      });

      const rows = [];
      const missing = [];

      for (const r of results) {
        if (!r.valid) missing.push(r.twitch);

        rows.push([
          categoryName,
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

      if (rows.length) {
        await appendRows(rows);
      }

      let summary = `VOD Check Complete\n\n`;

      if (!results.length) {
        summary +=
          "No Twitch usernames found in this channel.\n" +
          "Post plain usernames (one per line or comma-separated), then run this command again.";
      } else if (missing.length) {
        summary += `Issues Found (${missing.length})\n${missing.join("\n")}`;
      } else {
        summary += "All listed channels have valid VODs.";
      }

      await interaction.followUp(summary);
    } catch (err) {
      console.error("VODCHECK ERROR:", err);

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
