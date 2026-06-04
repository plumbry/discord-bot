const axios = require("axios");
const {
  getApiBaseUrl,
  getDiscordApiKey,
  getDiscordApiHeaders
} = require("./discordApi");

const FEMALE_EVALUATED_PATH =
  process.env.DISCORD_FEMALE_EVALUATED_PATH ||
  "/api/discord/female-evaluated-members";

async function fetchFemaleEvaluatedMembers() {
  const apiKey = getDiscordApiKey();

  if (!apiKey) {
    throw new Error("DISCORD_SYNC_API_KEY is not configured");
  }

  const url = `${getApiBaseUrl()}${FEMALE_EVALUATED_PATH}`;
  const res = await axios.get(url, {
    headers: getDiscordApiHeaders(),
    timeout: 60_000,
    validateStatus: status => status < 500
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(`female-evaluated-members unauthorized (${res.status})`);
  }

  if (res.status !== 200) {
    throw new Error(
      `female-evaluated-members failed (${res.status}): ${JSON.stringify(res.data)}`
    );
  }

  const members = res.data?.members;

  return Array.isArray(members) ? members : [];
}

module.exports = {
  FEMALE_EVALUATED_PATH,
  fetchFemaleEvaluatedMembers
};
