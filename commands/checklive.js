const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { google } = require("googleapis");
const fetch = require("node-fetch");

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
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

const TWITCH_REGEX = /twitch\.tv\/([a-zA-Z0-9_]+)/gi;

async function getAccessToken() {

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      `client_id=${process.env.TWITCH_CLIENT_ID}` +
      `&client_secret=${process.env.TWITCH_CLIENT_SECRET}` +
      `&grant_type=client_credentials`
  });

  const data = await res.json();
  return data.access_token;

}

async function getTwitchUsers(channel) {

  let lastId;
  const users = new Map();

  while (true) {

    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);
    if (!messages.size) break;

    for (const msg of messages.values()) {

      const matches = msg.content.match(TWITCH_REGEX);
      if (!matches) continue;

      const isStaff = msg.member?.permissions?.has(PermissionFlagsBits.ManageRoles);
      const batchMode = isStaff && matches.length > 5;

      for (const link of matches) {

        const twitch = link.split("twitch.tv/")[1].toLowerCase();

        users.set(twitch, {
          twitch,
          discordTag: batchMode ? "" : `<@${msg.author.id}>`
        });

      }

    }

    lastId = messages.last().id;

  }

  return [...users.values()];

}

async function checkLiveStatus(users, token) {

  if (!users.length) return {};

  const url =
    "https://api.twitch.tv/helix/streams?" +
    users.map(u => `user_login=${u.twitch}`).join("&");

  const res = await fetch(url, {
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`
    }
  });

  const data = await res.json();

  const liveMap = {};

  data.data.forEach(stream => {
    liveMap[stream.user_login.toLowerCase()] = stream;
  });

  return liveMap;

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

    await interaction.reply("Checking Twitch streams...");

    const users = await getTwitchUsers(interaction.channel);

    if (!users.length) {

      await interaction.followUp("No Twitch links found in this channel.");
      return;

    }

    const token = await getAccessToken();
    const liveMap = await checkLiveStatus(users, token);

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

      if (!live) {
        offlineList.push(user.twitch);
      }

    }

    await appendRows(rows);

    let message = `Live Check Complete\n\n`;

    if (offlineList.length) {

      message += `⚠️ NOT LIVE (${offlineList.length})\n`;
      message += offlineList.join("\n");

    } else {

      message += `All submitted players are currently live.`;

    }

    await interaction.followUp(message);

  }

};