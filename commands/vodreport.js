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