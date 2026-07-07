const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getSheets } = require("../lib/sheets");
const { getAccessToken } = require("../twitchBatch");
const {
  findEventChannels,
  scanPostedChannelVods,
  collectPostedLoginsByAuthor,
  collectTeamTaggedLogins
} = require("../lib/vodEventScan");
const { getTeams } = require("./teamstreamcheck");

const SPREADSHEET_ID = process.env.MAIN_SHEET_ID;
const SHEET_NAME = "'VOD Report'";

function requiredVodsForTeam(team, categoryName = "") {
  const name = categoryName.toLowerCase();

  if (name.includes("squad")) {
    return 2;
  }

  return team.members.length >= 4 ? 2 : 1;
}

function filterMissingByTeamCompliance({
  missing,
  teams,
  results,
  loginsByAuthor,
  loginsByTeamNumber = new Map(),
  categoryName = ""
}) {
  if (!teams.length) return missing;

  const resultsByTwitch = new Map(results.map(r => [r.twitch, r]));
  const exemptLogins = new Set();

  for (const team of teams) {
    const required = requiredVodsForTeam(team, categoryName);
    const teamLogins = new Set();

    for (const memberId of team.members) {
      for (const login of loginsByAuthor.get(memberId) || []) {
        teamLogins.add(login);
      }
    }

    for (const login of loginsByTeamNumber.get(team.number) || []) {
      teamLogins.add(login);
    }

    let validCount = 0;

    for (const login of teamLogins) {
      if (resultsByTwitch.get(login)?.valid) {
        validCount++;
        if (validCount >= required) break;
      }
    }

    if (validCount >= required) {
      for (const login of teamLogins) {
        exemptLogins.add(login);
      }
    }
  }

  return missing.filter(twitch => {
    const result = resultsByTwitch.get(twitch);

    if (result?.note === "Invalid Twitch channel") {
      return true;
    }

    return !exemptLogins.has(twitch);
  });
}

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

      const { signupChannel, streamChannel } = findEventChannels(
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

      let loginsByAuthor = new Map();
      let loginsByTeamNumber = new Map();
      let teams = [];

      if (signupChannel) {
        [teams, loginsByAuthor, loginsByTeamNumber] = await Promise.all([
          getTeams(signupChannel),
          collectPostedLoginsByAuthor(streamChannel, token),
          collectTeamTaggedLogins(streamChannel, token)
        ]);
      }

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

      const reportedMissing = filterMissingByTeamCompliance({
        missing,
        teams,
        results,
        loginsByAuthor,
        loginsByTeamNumber,
        categoryName: category.name
      });

      await appendRows(rows);

      let summary = `VOD Report Complete\n\n`;

      if (!results.length) {
        summary += "No Twitch channel links posted.";
      } else if (reportedMissing.length) {
        summary += `Issues Found (${reportedMissing.length})\n${reportedMissing.join("\n")}`;
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
