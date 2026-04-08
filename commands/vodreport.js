const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { google } = require("googleapis");
const fetch = require("node-fetch");

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_NAME = "'VOD Report'";
const ACCEPTED_EMOJI_ID = "1405510864496361482";
const TWITCH_REGEX = /twitch\.tv\/([a-zA-Z0-9_]+)/i;

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

/* ---------- UTIL ---------- */

const normalize = str =>
  str.toLowerCase().replace(/[^a-z0-9]/g, "");

function parseDuration(duration) {
  const match = duration.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  return (parseInt(match?.[1] || 0) * 3600) +
         (parseInt(match?.[2] || 0) * 60) +
         (parseInt(match?.[3] || 0));
}

function vodOverlaps(vod, start, end) {
  const vodStart = new Date(vod.created_at);
  const vodEnd = new Date(vodStart.getTime() + parseDuration(vod.duration) * 1000);
  return vodStart < end && vodEnd > start;
}

/* ---------- DISCORD HELPERS ---------- */

async function fetchAllMessages(channel) {
  try {
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

  } catch (err) {
    console.error(`Failed fetching messages in ${channel?.name}:`, err.message);
    return [];
  }
}

async function getAcceptedTeams(signupChannel) {
  const messages = await fetchAllMessages(signupChannel);
  const teams = [];

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const accepted = msg.reactions.cache.some(
      r => r.emoji.id === ACCEPTED_EMOJI_ID && r.count > 0
    );

    if (!accepted) continue;

    const members = [...msg.mentions.users.values()].map(u => u.id);

    if (members.length) teams.push({ members });
  }

  return teams;
}

async function getStreamLinks(streamChannel) {
  const messages = await fetchAllMessages(streamChannel);
  const streams = new Map();

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const match = msg.content.match(TWITCH_REGEX);
    if (!match) continue;

    streams.set(msg.author.id, match[1].toLowerCase());
  }

  return streams;
}

/* ---------- TWITCH ---------- */

async function getAccessToken() {
  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials"
  });

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
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

/* ---------- SHEETS ---------- */

async function appendRows(rows) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });
}

/* ---------- COMMAND ---------- */

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

      const channels = interaction.guild.channels.cache;

      const signupChannel = channels.find(c => {
        if (c.parentId !== category.id || !c.isTextBased()) return false;
        const name = normalize(c.name);
        return name.includes("signup") || name.includes("teams");
      });

      const streamChannel = channels.find(c => {
        if (c.parentId !== category.id || !c.isTextBased()) return false;
        const name = normalize(c.name);
        return name.includes("twitch") && (name.includes("stream") || name.includes("link"));
      });

      console.log("Signup:", signupChannel?.name);
      console.log("Stream:", streamChannel?.name);

      if (!signupChannel || !streamChannel) {
        return interaction.reply({
          content: "Could not locate signups or twitch channel.",
          ephemeral: true
        });
      }

      await interaction.reply("Scanning teams and Twitch streams...");

      const teams = await getAcceptedTeams(signupChannel);
      const streams = await getStreamLinks(streamChannel);

      console.log("Teams:", teams.length);
      console.log("Streams:", streams.size);

      const token = await getAccessToken();

      if (!token) throw new Error("Failed to get Twitch token");

      const date = interaction.options.getString("date");
      const start = new Date(`${date}T${interaction.options.getString("start")}:00Z`);
      const end = new Date(`${date}T${interaction.options.getString("end")}:00Z`);

      const rows = [];
      const missing = [];

      for (const team of teams) {

        const streamer = team.members.find(id => streams.has(id));

        if (!streamer) {
          missing.push(`Team missing stream: ${team.members.map(m => `<@${m}>`).join(" ")}`);
          continue;
        }

        const twitch = streams.get(streamer);

        let valid = false;
        let lastStream = "";
        let vodStart = "";
        let vodEnd = "";
        let note = "No public VOD";

        const userId = await getUserId(twitch, token);

        if (userId) {
          const vods = await getRecentVods(userId, token);

          if (vods.length) {
            lastStream = vods[0].created_at;

            for (const vod of vods) {
              if (vod.viewable !== "public") continue;

              if (vodOverlaps(vod, start, end)) {
                const startDate = new Date(vod.created_at);
                const endDate = new Date(startDate.getTime() + parseDuration(vod.duration) * 1000);

                vodStart = startDate.toISOString();
                vodEnd = endDate.toISOString();

                valid = true;
                note = "Public VOD overlaps event";
                break;
              }
            }
          }
        }

        if (!valid) missing.push(twitch);

        rows.push([
          category.name,
          `<@${streamer}>`,
          twitch,
          lastStream,
          vodStart,
          vodEnd,
          valid ? "YES" : "NO",
          note,
          new Date().toISOString(),
          `<@${interaction.user.id}>`
        ]);
      }

      await appendRows(rows);

      let summary = `VOD Report Complete\n\n`;

      if (missing.length) {
        summary += `Issues Found (${missing.length})\n${missing.join("\n")}`;
      } else {
        summary += "All teams submitted valid VODs.";
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