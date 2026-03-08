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

  const h = parseInt(match?.[1] || 0);
  const m = parseInt(match?.[2] || 0);
  const s = parseInt(match?.[3] || 0);

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
    .setName("vodreport")
    .setDescription("Check Twitch VOD compliance for event")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
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

    const checkedBy = `<@${interaction.user.id}>`;
    const checkedAt = new Date().toISOString();

    await interaction.reply("Scanning Twitch VODs...");

    const users = await getTwitchUsers(interaction.channel);
    const token = await getAccessToken();

    const rows = [];
    const missing = [];

    for (const user of users) {

      const username = user.twitch;
      const discordUser = user.discordTag;

      let lastStream = "";
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

          if (!valid) missing.push(username);

        } else {

          missing.push(username);

        }

      }

      rows.push([
        categoryName,
        discordUser,
        username,
        lastStream,
        vodStart,
        vodEnd,
        valid ? "YES" : "NO",
        note,
        checkedAt,
        checkedBy
      ]);

      await new Promise(r => setTimeout(r, 400));

    }

    await appendRows(rows);

    let summary = `VOD Report Complete\n\n`;

    if (missing.length) {

      summary += `Missing Public VODs (${missing.length})\n`;
      summary += missing.join("\n");

    } else {

      summary += "All submitted streams have valid VODs.";

    }

    await interaction.followUp(summary);

  }

};