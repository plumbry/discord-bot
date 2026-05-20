const fetch = require("node-fetch");

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {

  const now = Date.now();

  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      `client_id=${process.env.TWITCH_CLIENT_ID}` +
      `&client_secret=${process.env.TWITCH_CLIENT_SECRET}` +
      `&grant_type=client_credentials`
  });

  const data = await res.json();

  cachedToken = data.access_token;
  tokenExpiresAt =
    now + (Number(data.expires_in) || 3600) * 1000;

  return cachedToken;

}

async function getLiveStreams(usernames, token) {

  if (!usernames.length) {
    return {};
  }

  const url =
    "https://api.twitch.tv/helix/streams?" +
    usernames.map(u => `user_login=${u}`).join("&");

  const res = await fetch(url, {
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`
    }
  });

  const data = await res.json();

  const liveMap = {};

  for (const stream of data.data || []) {
    liveMap[stream.user_login.toLowerCase()] = stream;
  }

  return liveMap;

}

module.exports = {
  getAccessToken,
  getLiveStreams
};
