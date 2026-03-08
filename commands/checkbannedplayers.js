const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { google } = require("googleapis");

const EVENT_BAN_SHEET = "Event Bans";

const credentials = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

async function getEventBans() {

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${EVENT_BAN_SHEET}!A2:J`
  });

  const rows = res.data.values || [];

  const banned = new Map();

  for (const r of rows) {

    const userId = r[0];
    const type = r[2];
    const remaining = Number(r[4]);

    if (type !== "Probation" && remaining > 0) {
      banned.set(userId, true);
    }

  }

  return banned;

}

async function fetchAllMessages(channel) {

  let messages = [];
  let lastId;

  while (true) {

    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);

    if (!batch.size) break;

    messages.push(...batch.values());
    lastId = batch.last().id;

  }

  return messages.reverse();

}

module.exports = {

  data: new SlashCommandBuilder()
    .setName("checkbannedplayers")
    .setDescription("Check if signed up players have active event bans")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {

    await interaction.reply("Scanning signups and event bans...");

    const bannedUsers = await getEventBans();

    const messages = await fetchAllMessages(interaction.channel);

    const bannedTeams = [];

    let teamNumber = 1;

    for (const msg of messages) {

      if (msg.author.bot) continue;

      const accepted = msg.reactions.cache.some(
        r => r.emoji.name === "ZBDACCEPTED"
      );

      if (!accepted) continue;

      const members = [...msg.mentions.users.values()];

      const bannedPlayers = members.filter(m =>
        bannedUsers.has(m.id)
      );

      if (bannedPlayers.length) {

        bannedTeams.push({
          team: teamNumber,
          players: bannedPlayers
        });

      }

      teamNumber++;

    }

    if (!bannedTeams.length) {

      return interaction.followUp(
        "✅ No signed up players currently have active event bans."
      );

    }

    let message = "🚫 **Players With Active Event Bans**\n\n";

    for (const team of bannedTeams) {

      message += `Team ${team.team}\n`;

      for (const player of team.players) {
        message += `<@${player.id}>\n`;
      }

      message += "\n";

    }

    await interaction.followUp(message);

  }

};