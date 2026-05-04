const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { google } = require("googleapis");
const { getAccessToken, getLiveStreams } = require("../twitchBatch");

const SPREADSHEET_ID = process.env.MAIN_SHEET_ID;
const SHEET_NAME = "'Live Check'";

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

const TWITCH_REGEX = /twitch\.tv\/([a-zA-Z0-9_]+)/i;

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

  return messages;
}

async function getTwitchUsers(channel) {

  const messages = await fetchAllMessages(channel);
  const users = new Map();

  for (const msg of messages) {

    if (msg.author.bot) continue;

    const match = msg.content.match(TWITCH_REGEX);
    if (!match) continue;

    const twitch = match[1].toLowerCase();

    users.set(twitch, {
      twitch,
      discordTag: `<@${msg.author.id}>`
    });

  }

  return [...users.values()];
}

async function appendRows(rows) {

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });

}

module.exports = {

  data: new SlashCommandBuilder()
    .setName("checklive")
    .setDescription("Check which submitted Twitch links are currently live")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {

    const categoryName =
      interaction.channel.parent?.name || "No Category";

    const checkedBy = `<@${interaction.user.id}>`;
    const checkedAt = new Date().toISOString();

    await interaction.deferReply();

    const users = await getTwitchUsers(interaction.channel);

    if (!users.length) {

      await interaction.editReply("No Twitch links found in this channel.");
      return;

    }

    const token = await getAccessToken();

    const usernames = users.map(u => u.twitch);

    const liveMap = await getLiveStreams(usernames, token);

    const rows = [];
    const offlineList = [];

    for (const user of users) {

      const stream = liveMap[user.twitch];
      const live = !!stream;
      const title = stream?.title || "";

      rows.push([
        categoryName,
        user.discordTag,
        user.twitch,
        live ? "YES" : "NO",
        title,
        checkedAt,
        checkedBy
      ]);

      if (!live) offlineList.push(user.twitch);

    }

    await appendRows(rows);

    let message = `Live Check Complete\n\n`;

    if (offlineList.length) {

      message += `⚠️ NOT LIVE (${offlineList.length})\n`;
      message += offlineList.join("\n");

    } else {

      message += `All submitted players are currently live.`;

    }

    await interaction.editReply(message);

  }

};