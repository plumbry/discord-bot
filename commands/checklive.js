const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getAccessToken, getLiveStreams } = require("../twitchBatch");
const { getSheets } = require("../lib/sheets");
const { fetchAllMessages } = require("../lib/messages");

const SPREADSHEET_ID = process.env.MAIN_SHEET_ID;
const SHEET_NAME = "'Live Check'";

const TWITCH_REGEX = /twitch\.tv\/([a-zA-Z0-9_]+)/i;

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

  await getSheets().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });

}

async function runLiveCheck({
  channel,
  user
}) {
  const categoryName =
    channel.parent?.name || "No Category";

  const checkedBy = user ? `<@${user.id}>` : "";
  const checkedAt = new Date().toISOString();
  const users = await getTwitchUsers(channel);

  if (!users.length) {
    return {
      users,
      offlineList: [],
      message: "No Twitch links found in this channel."
    };
  }

  const token = await getAccessToken();
  const usernames = users.map(u => u.twitch);
  const liveMap = await getLiveStreams(usernames, token);

  const rows = [];
  const offlineList = [];

  for (const userEntry of users) {
    const stream = liveMap[userEntry.twitch];
    const live = !!stream;
    const title = stream?.title || "";

    rows.push([
      categoryName,
      userEntry.discordTag,
      userEntry.twitch,
      live ? "YES" : "NO",
      title,
      checkedAt,
      checkedBy
    ]);

    if (!live) offlineList.push(userEntry.twitch);
  }

  await appendRows(rows);

  let message = `Live Check Complete\n\n`;

  if (offlineList.length) {
    message += `⚠️ NOT LIVE (${offlineList.length})\n`;
    message += offlineList.join("\n");
  } else {
    message += `All submitted players are currently live.`;
  }

  return { users, offlineList, message };
}

module.exports = {

  data: new SlashCommandBuilder()
    .setName("checklive")
    .setDescription("Check which submitted Twitch links are currently live")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {

    await interaction.deferReply();

    const { message } = await runLiveCheck({
      channel: interaction.channel,
      user: interaction.user
    });

    await interaction.editReply(message);

  }

};

module.exports.runLiveCheck = runLiveCheck;