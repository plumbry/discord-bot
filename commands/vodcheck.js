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

async function runVodCheck({
  channel,
  date,
  startTime,
  endTime,
  user
}) {
  const categoryName =
    channel.parent?.name || channel.name;

  const token = await getAccessToken();
  if (!token) throw new Error("Failed to get Twitch token");

  const start = new Date(`${date}T${startTime}:00Z`);
  const end = new Date(`${date}T${endTime}:00Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date or time. Use YYYY-MM-DD and HH:MM UTC.");
  }

  const results = await scanChannelVods({
    channel,
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
      user ? `<@${user.id}>` : ""
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

  return { results, missing, summary };
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
      await interaction.reply(
        "Scanning Twitch usernames in this channel..."
      );

      const date = interaction.options.getString("date");
      const { summary } = await runVodCheck({
        channel: interaction.channel,
        date,
        startTime: interaction.options.getString("start"),
        endTime: interaction.options.getString("end"),
        user: interaction.user
      });

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

module.exports.runVodCheck = runVodCheck;
