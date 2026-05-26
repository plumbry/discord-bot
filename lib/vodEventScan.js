const fetch = require("node-fetch");
const { fetchAllMessages } = require("./messages");

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

async function getUserId(username, token) {
  const data = await twitchGet(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(username)}`,
    token
  );
  return data.data?.[0]?.id;
}

async function getVideoById(videoId, token) {
  const data = await twitchGet(
    `https://api.twitch.tv/helix/videos?id=${videoId}`,
    token
  );
  return data.data?.[0] || null;
}

async function getRecentVods(userId, token, first = 5) {
  const data = await twitchGet(
    `https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=${first}`,
    token
  );
  return data.data || [];
}

function isViewableVod(vod) {
  return vod.viewable !== "private";
}

function findOverlappingVod(vods, start, end) {
  for (const vod of vods) {
    if (!isViewableVod(vod)) continue;
    if (vodOverlaps(vod, start, end)) return vod;
  }
  return null;
}

function vodTimestamps(vod) {
  const startDate = new Date(vod.created_at);
  const endDate = new Date(
    startDate.getTime() + parseDuration(vod.duration) * 1000
  );

  return {
    vodStart: startDate.toISOString(),
    vodEnd: endDate.toISOString(),
    createdAt: vod.created_at,
    publishedAt: vod.published_at || vod.created_at
  };
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

async function collectPostedChannels(streamChannel, token) {
  const messages = await fetchAllMessages(streamChannel);
  const seen = new Set();
  const channels = [];

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const { login, videoId } = parseTwitchFromContent(msg.content);
    if (!login && !videoId) continue;

    let resolvedLogin = login;

    if (!resolvedLogin && videoId) {
      const vod = await getVideoById(videoId, token);
      resolvedLogin = vod?.user_login?.toLowerCase() || null;
    }

    if (!resolvedLogin || seen.has(resolvedLogin)) continue;

    seen.add(resolvedLogin);
    channels.push({ login: resolvedLogin, videoId: videoId || null });
  }

  return channels;
}

async function scanPostedChannelVods({ streamChannel, token, start, end }) {
  const posted = await collectPostedChannels(streamChannel, token);
  const results = [];

  for (const { login, videoId } of posted) {
    let matchedVod = null;
    let lastStream = "";

    const userId = await getUserId(login, token);
    let recent = [];

    if (userId) {
      recent = await getRecentVods(userId, token);
      if (recent.length) {
        lastStream = recent[0].created_at;
      }
    }

    if (videoId) {
      const linked = await getVideoById(videoId, token);
      if (linked && isViewableVod(linked) && vodOverlaps(linked, start, end)) {
        matchedVod = linked;
      }
    }

    if (!matchedVod) {
      matchedVod = findOverlappingVod(recent, start, end);
    }

    if (matchedVod) {
      const ts = vodTimestamps(matchedVod);
      results.push({
        twitch: login,
        valid: true,
        lastStream: lastStream || matchedVod.created_at,
        vodStart: ts.vodStart,
        vodEnd: ts.vodEnd,
        note: "Public VOD overlaps event",
        createdAt: ts.createdAt,
        publishedAt: ts.publishedAt
      });
    } else {
      results.push({
        twitch: login,
        valid: false,
        lastStream,
        vodStart: "",
        vodEnd: "",
        note: "No public VOD",
        createdAt: null,
        publishedAt: null
      });
    }
  }

  return results;
}

module.exports = {
  findEventChannels,
  scanPostedChannelVods
};
