const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { google } = require("googleapis");
const fetch = require("node-fetch");

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = "'VOD Report'";

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

function parseDuration(duration) {

  const match = duration.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);

  const h = parseInt(match[1] || 0);
  const m = parseInt(match[2] || 0);
  const s = parseInt(match[3] || 0);

  return h * 3600 + m * 60 + s;

}

function vodOverlaps(vod, start, end) {

  const vodStart = new Date(vod.created_at);
  const duration = parseDuration(vod.duration);
  const vodEnd = new Date(vodStart.getTime() + duration * 1000);

  return vodStart < end && vodEnd > start;

}

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

async function getUserId(username, token) {

  const res = await fetch(
    `https://api.twitch.tv/helix/users?login=${username}`,
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data = await res.json();
  return data.data?.[0]?.id;

}

async function getRecentVods(userId, token) {

  const res = await fetch(
    `https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=5`,
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data = await res.json();
  return data.data || [];

}

async function getTwitchUsers(channel) {

  let lastId;
  const users = new Set();

  while (true) {

    const options = { limit: 100 };

    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);

    if (!messages.size) break;

    messages.forEach(msg => {

      const matches = [...msg.content.matchAll(TWITCH_REGEX)];

      matches.forEach(match => {
        users.add(match[1].toLowerCase());
      });

    });

    lastId = messages.last().id;

  }

  return [...users];

}

async function writeRow(row) {

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [row] }
  });

}

module.exports = {

  data: new SlashCommandBuilder()
    .setName("vodreport")
    .setDescription("Check Twitch streams for event VODs")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)

    .addStringOption(o =>
      o.setName("date")
        .setDescription("Event date (YYYY-MM-DD)")
        .setRequired(true))

    .addStringOption(o =>
      o.setName("start")
        .setDescription("Start time UTC (HH:MM)")
        .setRequired(true))

    .addStringOption(o =>
      o.setName("end")
        .setDescription("End time UTC (HH:MM)")
        .setRequired(true)),

  async execute(interaction) {

    const date = interaction.options.getString("date");
    const startTime = interaction.options.getString("start");
    const endTime = interaction.options.getString("end");

    const start = new Date(`${date}T${startTime}:00Z`);
    const end = new Date(`${date}T${endTime}:00Z`);

    const categoryName =
      interaction.channel.parent?.name || "No Category";

    await interaction.reply({
      content: "Scanning Twitch streams...",
      ephemeral: true
    });

    const users = await getTwitchUsers(interaction.channel);
    const token = await getAccessToken();

    for (const username of users) {

      let lastStream = "None";
      let vodStart = "";
      let vodEnd = "";
      let valid = false;
      let note = "No public VOD";

      const userId = await getUserId(username, token);

      if (userId) {

        const vods = await getRecentVods(userId, token);

        if (vods.length) {

          lastStream = vods[0].created_at;

          for (const vod of vods) {

            if (vod.viewable !== "public") continue;

            if (vodOverlaps(vod, start, end)) {

              const startDate = new Date(vod.created_at);
              const duration = parseDuration(vod.duration);
              const endDate = new Date(startDate.getTime() + duration * 1000);

              vodStart = startDate.toISOString();
              vodEnd = endDate.toISOString();

              valid = true;
              note = "Public VOD overlaps event";

              break;

            }

          }

          if (!valid) note = "Stream outside event window";

        }

      } else {

        note = "Twitch user not found";

      }

      await writeRow([
        categoryName,
        username,
        lastStream,
        vodStart,
        vodEnd,
        valid ? "YES" : "NO",
        note
      ]);

      await new Promise(r => setTimeout(r, 400));

    }

    await interaction.followUp({
      content: `Finished scanning ${users.length} Twitch channels.`,
      ephemeral: true
    });

  }

};