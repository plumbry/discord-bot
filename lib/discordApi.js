const DEFAULT_API_BASE_URL = "https://healthy-husky-184.convex.site";

function getApiBaseUrl() {
  return (
    process.env.SCRIM_EVENTS_API_BASE_URL ||
    process.env.CONVEX_API_BASE_URL ||
    DEFAULT_API_BASE_URL
  ).replace(/\/$/, "");
}

function getDiscordApiKey() {
  return (
    process.env.DISCORD_SYNC_API_KEY ||
    process.env.EVENT_BAN_WEBHOOK_SECRET ||
    ""
  );
}

function getDiscordApiHeaders() {
  const apiKey = getDiscordApiKey();

  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  };
}

module.exports = {
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  getDiscordApiKey,
  getDiscordApiHeaders
};
