const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const fetch = require("node-fetch");
const { getSheets } = require("../lib/sheets");
const { fetchAllMessages } = require("../lib/messages");
const { getAccessToken } = require("../twitchBatch");

const SPREADSHEET_ID = process.env.MAIN_SHEET_ID;
const SHEET_NAME = "'VOD Report'";
const ACCEPTED_EMOJI_ID = "1405510864496361482";
const VOD_PUBLISH_REPORT_CHANNEL_ID = "1471082166535454780";

const RESERVED_TWITCH_PATHS = new Set([
  "videos",
  "video",
  "clip",
  "clips",
  "directory",
  "settings",
  "downloads",
  "jobs",
  "p",
  "popout",
  "embed",
  "subscription"
]);

/* ---------- UTIL ---------- */

const normalize = str =>
  str.toLowerCase().replace(/[^a-z0-9]/g, "");

function parseDuration(duration) {
  if (!duration || typeof duration !== "string") return 0;

  const match = duration.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
  return (parseInt(match?.[1] || 0, 10) * 3600) +
         (parseInt(match?.[2] || 0, 10) * 60) +
         (parseInt(match?.[3] || 0, 10));
}

function vodOverlaps(vod, start, end) {
  const vodStart = new Date(vod.created_at);
  const vodEnd = new Date(
    vodStart.getTime() + parseDuration(vod.duration) * 1000
  );
  return vodStart < end && vodEnd > start;
}

function parseTwitchFromContent(content) {
  let login = null;
  let videoId = null;

  for (const match of content.matchAll(/twitch\.tv\/([a-zA-Z0-9_]+)/gi)) {
    const segment = match[1].toLowerCase();
    if (!RESERVED_TWITCH_PATHS.has(segment)) {
      login = segment;
      break;
    }
  }

  const videoMatch = content.match(/twitch\.tv\/videos\/(\d+)/i);
  if (videoMatch) {
    videoId = videoMatch[1];
  }

  return { login, videoId };
}

function twitchHeaders(token) {
  return {
    "Client-ID": process.env.TWITCH_CLIENT_ID,
    Authorization: `Bearer ${token}`
  };
}

async function twitchGet(url, token) {
  const res = await fetch(url, { headers: twitchHeaders(token) });
  const data = await res.json();

  if (!res.ok || data.error) {
    throw new Error(
      data.message || `Twitch API error (${res.status})`
    );
  }

  return data;
}

/* ---------- DISCORD HELPERS ---------- */

async function getAcceptedTeams(signupChannel) {
  const messages = await fetchAllMessages(signupChannel);
  const teams = [];

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const accepted = msg.reactions.cache.some(
      r => r.emoji.id === ACCEPTED_EMOJI_ID && r.count > 0
    );

    if (!accepted) continue;

    const members = [
      msg.author.id,
      ...msg.mentions.users.keys()
    ];

    const uniqueMembers = [...new Set(members)];

    if (uniqueMembers.length) {
      teams.push({ members: uniqueMembers });
    }
  }

  return teams;
}

async function getStreamLinks(streamChannel, token) {
  const messages = await fetchAllMessages(streamChannel);
  const byAuthor = new Map();

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const { login, videoId } = parseTwitchFromContent(msg.content);
    if (!login && !videoId) continue;

    const prev = byAuthor.get(msg.author.id) || {};
    if (login) prev.login = login;
    if (videoId) prev.videoId = videoId;
    byAuthor.set(msg.author.id, prev);
  }

  const streams = new Map();

  for (const [authorId, { login, videoId }] of byAuthor) {
    if (login) {
      streams.set(authorId, login);
      continue;
    }

    if (videoId) {
      const data = await twitchGet(
        `https://api.twitch.tv/helix/videos?id=${videoId}`,
        token
      );
      const resolved = data.data?.[0]?.user_login?.toLowerCase();
      if (resolved) {
        streams.set(authorId, resolved);
      }
    }
  }

  return streams;
}

/* ---------- TWITCH ---------- */

async function getUserId(username, token) {
  const data = await twitchGet(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
    token
  );
  return data.data?.[0]?.id;
}

async function getRecentVods(userId, token) {
  const data = await twitchGet(
    `https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=5`,
    token
  );
  return data.data || [];
}

function isViewableVod(vod) {
  return vod.viewable !== "private";
}

function formatPublishedAt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function chunkDiscordMessages(text, limit = 2000) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > limit) {
      if (current) chunks.push(current);
      current = line.length > limit ? line.slice(0, limit) : line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function postVodPublishReport(client, {
  categoryName,
  date,
  startTime,
  endTime,
  entries
}) {
  const reportChannel = await client.channels
    .fetch(VOD_PUBLISH_REPORT_CHANNEL_ID)
    .catch(() => null);

  if (!reportChannel?.isTextBased()) {
    console.warn(
      "VOD publish report: channel unavailable",
      VOD_PUBLISH_REPORT_CHANNEL_ID
    );
    return;
  }

  const header = [
    `**VOD publish report** — ${categoryName}`,
    `Event window: ${date} ${startTime}–${endTime} UTC`,
    ""
  ].join("\n");

  const lines = entries.map(entry => {
    if (!entry.twitch) {
      return `• ${entry.streamerMention} — no stream link`;
    }
    if (!entry.publishedAt) {
      return `• ${entry.streamerMention} (**${entry.twitch}**) — no VOD overlapping event window`;
    }

    const urlPart = entry.vodUrl ? ` — ${entry.vodUrl}` : "";
    return `• ${entry.streamerMention} (**${entry.twitch}**) — published ${formatPublishedAt(entry.publishedAt)}${urlPart}`;
  });

  const body = lines.length ? lines.join("\n") : "_No accepted teams._";
  const messages = chunkDiscordMessages(`${header}${body}`);

  for (const content of messages) {
    await reportChannel.send({ content });
  }
}

/* ---------- SHEETS ---------- */

async function appendRows(rows) {
  await getSheets().spreadsheets.values.append({
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

        if (name.includes("solo")) return false;

        return (
          name.includes("signup") ||
          name.includes("teams")
        );
      });

      const streamChannel = channels.find(c => {
        if (c.parentId !== category.id || !c.isTextBased()) return false;

        const name = normalize(c.name);

        return (
          name.includes("twitch") &&
          (name.includes("stream") || name.includes("link"))
        );
      });

      console.log("Signup:", signupChannel?.name);
      console.log("Stream:", streamChannel?.name);

      if (!signupChannel || !streamChannel) {
        return interaction.reply({
          content: "Could not locate correct signup or twitch channel.",
          ephemeral: true
        });
      }

      await interaction.reply("Scanning teams and Twitch streams...");

      const token = await getAccessToken();
      if (!token) throw new Error("Failed to get Twitch token");

      const teams = await getAcceptedTeams(signupChannel);
      const streams = await getStreamLinks(streamChannel, token);

      const date = interaction.options.getString("date");
      const start = new Date(`${date}T${interaction.options.getString("start")}:00Z`);
      const end = new Date(`${date}T${interaction.options.getString("end")}:00Z`);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new Error("Invalid date or time. Use YYYY-MM-DD and HH:MM UTC.");
      }

      const rows = [];
      const missing = [];
      const publishEntries = [];
      const startTime = interaction.options.getString("start");
      const endTime = interaction.options.getString("end");

      for (const team of teams) {

        const streamer = team.members.find(id => streams.has(id));

        if (!streamer) {
          missing.push(`Team missing stream: ${team.members.map(m => `<@${m}>`).join(" ")}`);
          publishEntries.push({
            streamerMention: team.members.map(m => `<@${m}>`).join(" "),
            twitch: null,
            publishedAt: null,
            vodUrl: null
          });
          continue;
        }

        const twitch = streams.get(streamer);

        let valid = false;
        let lastStream = "";
        let vodStart = "";
        let vodEnd = "";
        let note = "No public VOD";
        let publishedAt = null;
        let vodUrl = null;

        const userId = await getUserId(twitch, token);

        if (userId) {
          const vods = await getRecentVods(userId, token);

          if (vods.length) {
            lastStream = vods[0].created_at;

            for (const vod of vods) {
              if (!isViewableVod(vod)) continue;

              if (vodOverlaps(vod, start, end)) {
                const startDate = new Date(vod.created_at);
                const endDate = new Date(
                  startDate.getTime() + parseDuration(vod.duration) * 1000
                );

                vodStart = startDate.toISOString();
                vodEnd = endDate.toISOString();
                publishedAt = vod.published_at || vod.created_at;
                vodUrl = vod.url || null;

                valid = true;
                note = "Public VOD overlaps event";
                break;
              }
            }
          }
        }

        if (!valid) missing.push(twitch);

        publishEntries.push({
          streamerMention: `<@${streamer}>`,
          twitch,
          publishedAt,
          vodUrl
        });

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

      await postVodPublishReport(interaction.client, {
        categoryName: category.name,
        date,
        startTime,
        endTime,
        entries: publishEntries
      });

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
