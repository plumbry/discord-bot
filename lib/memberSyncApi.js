const axios = require("axios");
const { getApiBaseUrl, getDiscordApiKey, getDiscordApiHeaders } = require("./discordApi");

const SYNC_MEMBER_PATH = "/api/discord/sync-member";
const MEMBER_SYNC_REQUEST_TIMEOUT_MS = Number(process.env.MEMBER_SYNC_REQUEST_TIMEOUT_MS || 15_000);
const MEMBER_SYNC_PER_MEMBER_DELAY_MS = Number(process.env.MEMBER_SYNC_PER_MEMBER_DELAY_MS || 100);
const MEMBER_SYNC_MAX_RETRIES = Number(process.env.MEMBER_SYNC_MAX_RETRIES || 3);
const MEMBER_SYNC_RETRY_BASE_DELAY_MS = Number(
  process.env.MEMBER_SYNC_RETRY_BASE_DELAY_MS || 500
);
const MEMBER_SYNC_RETRY_MAX_DELAY_MS = Number(
  process.env.MEMBER_SYNC_RETRY_MAX_DELAY_MS || 10_000
);

function hasMemberSyncApiKey() {
  return Boolean(getDiscordApiKey());
}

function normalizeRoles(member) {
  const roles = member.roles.cache
    .filter(role => role.name !== "@everyone")
    .map(role => ({
      id: role.id,
      name: role.name
    }));

  return roles.length > 0 ? roles : null;
}

function buildMemberPayload(member) {
  return {
    id: member.user.id,
    username: member.user.username,
    nickname: member.nickname || null,
    joined_at: member.joinedAt
      ? member.joinedAt.toISOString()
      : new Date().toISOString(),
    roles: normalizeRoles(member)
  };
}

function shouldRetryRequestFailure(status, err) {
  if (status === 429) {
    return true;
  }

  if (typeof status === "number" && status >= 500) {
    return true;
  }

  // Network/timeouts generally have no HTTP status.
  if (!status && err) {
    return true;
  }

  return false;
}

function getRetryDelayMs(attemptNumber) {
  const cappedAttempt = Math.max(1, attemptNumber);
  const rawDelay = MEMBER_SYNC_RETRY_BASE_DELAY_MS * 2 ** (cappedAttempt - 1);
  const boundedDelay = Math.min(rawDelay, MEMBER_SYNC_RETRY_MAX_DELAY_MS);
  const jitter = Math.floor(Math.random() * 150);
  return boundedDelay + jitter;
}

async function postMemberPayloadWithRetry(url, payload) {
  let attempt = 0;
  let lastFailure = null;

  while (attempt <= MEMBER_SYNC_MAX_RETRIES) {
    try {
      await axios.post(url, payload, {
        headers: getDiscordApiHeaders(),
        timeout: MEMBER_SYNC_REQUEST_TIMEOUT_MS
      });

      return { ok: true, attempts: attempt + 1 };
    } catch (err) {
      const status = err?.response?.status || null;
      const body = err?.response?.data || null;
      const errorMessage = err?.message || String(err);
      const retryable = shouldRetryRequestFailure(status, err);
      lastFailure = {
        ok: false,
        skipped: false,
        reason: "request_failed",
        status,
        body,
        error: errorMessage,
        retryable,
        attempts: attempt + 1
      };

      if (!retryable || attempt >= MEMBER_SYNC_MAX_RETRIES) {
        return lastFailure;
      }

      const delayMs = getRetryDelayMs(attempt + 1);
      console.warn(
        `[MEMBER SYNC] retry ${attempt + 1}/${MEMBER_SYNC_MAX_RETRIES} ` +
          `in ${delayMs}ms (status=${status || "network"})`
      );
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    attempt++;
  }

  return (
    lastFailure || {
      ok: false,
      skipped: false,
      reason: "request_failed",
      status: null,
      body: null,
      error: "Unknown member sync failure",
      retryable: false,
      attempts: attempt + 1
    }
  );
}

async function syncMemberToWebsite(member) {
  if (!member || member.user?.bot) {
    return { ok: false, skipped: true, reason: "bot_or_missing_member" };
  }

  if (!hasMemberSyncApiKey()) {
    return { ok: false, skipped: true, reason: "missing_api_key" };
  }

  const url = `${getApiBaseUrl()}${SYNC_MEMBER_PATH}`;
  const payload = buildMemberPayload(member);

  return postMemberPayloadWithRetry(url, payload);
}

async function syncAllGuildMembers(guild) {
  if (!guild) {
    throw new Error("Guild is required");
  }

  await guild.members.fetch();

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const [, member] of guild.members.cache) {
    const result = await syncMemberToWebsite(member);

    if (result.ok) {
      successCount++;
      console.log(`[MEMBER SYNC] synced ${member.user.username}`);
    } else if (result.skipped) {
      skippedCount++;
    } else {
      errorCount++;
      console.error(
        `[MEMBER SYNC] failed ${member.user.username}:`,
        result.status || "no_status",
        result.body || result.error
      );
    }

    await new Promise(resolve => setTimeout(resolve, MEMBER_SYNC_PER_MEMBER_DELAY_MS));
  }

  return { successCount, errorCount, skippedCount };
}

module.exports = {
  hasMemberSyncApiKey,
  buildMemberPayload,
  syncMemberToWebsite,
  syncAllGuildMembers
};
