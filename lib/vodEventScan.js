const fetch = require("node-fetch");
const { fetchAllMessages } = require("./messages");

const ACCEPTED_EMOJI_ID = "1405510864496361482";

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

function findEventChannels(guild, category) {
  const channels = guild.channels.cache;

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

  return { signupChannel, streamChannel };
}

async function scanVodEvent({ signupChannel, streamChannel, token, start, end }) {
  const teams = await getAcceptedTeams(signupChannel);
  const streams = await getStreamLinks(streamChannel, token);
  const results = [];

  for (const team of teams) {
    const streamer = team.members.find(id => streams.has(id));

    if (!streamer) {
      results.push({
        members: team.members,
        streamer: null,
        twitch: null,
        valid: false,
        lastStream: "",
        vodStart: "",
        vodEnd: "",
        note: "No public VOD",
        publishedAt: null,
        createdAt: null
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
    let createdAt = null;

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
            createdAt = vod.created_at;
            publishedAt = vod.published_at || vod.created_at;

            valid = true;
            note = "Public VOD overlaps event";
            break;
          }
        }
      }
    }

    results.push({
      members: team.members,
      streamer,
      twitch,
      valid,
      lastStream,
      vodStart,
      vodEnd,
      note,
      publishedAt,
      createdAt
    });
  }

  return results;
}

module.exports = {
  findEventChannels,
  scanVodEvent
};
