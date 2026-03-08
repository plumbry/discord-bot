const fetch = require("node-fetch");

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

async function getLiveStreams(usernames, token) {

  if (!usernames.length) return {};

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

  for (const stream of data.data) {
    liveMap[stream.user_login.toLowerCase()] = stream;
  }

  return liveMap;

}

module.exports = {
  getAccessToken,
  getLiveStreams
};