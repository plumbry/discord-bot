const axios = require("axios");
const {
  getApiBaseUrl,
  getDiscordApiKey,
  getDiscordApiHeaders
} = require("./discordApi");

function requireApiKey() {
  const apiKey = getDiscordApiKey();

  if (!apiKey) {
    throw new Error("DISCORD_SYNC_API_KEY is not configured");
  }

  return apiKey;
}

async function fetchPendingList(pathLabel, path) {
  requireApiKey();

  const url = `${getApiBaseUrl()}${path}`;
  const res = await axios.get(url, {
    headers: getDiscordApiHeaders(),
    timeout: 30_000,
    validateStatus: status => status < 500
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(`${pathLabel} unauthorized (${res.status})`);
  }

  if (res.status !== 200) {
    throw new Error(
      `${pathLabel} failed (${res.status}): ${JSON.stringify(res.data)}`
    );
  }

  const pending = res.data?.pending;

  return Array.isArray(pending) ? pending : [];
}

async function postAck(pathLabel, path, body) {
  requireApiKey();

  const url = `${getApiBaseUrl()}${path}`;
  const res = await axios.post(url, body, {
    headers: getDiscordApiHeaders(),
    timeout: 30_000,
    validateStatus: status => status < 500
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error(`${pathLabel} unauthorized (${res.status})`);
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `${pathLabel} failed (${res.status}): ${JSON.stringify(res.data)}`
    );
  }
}

async function acknowledgeList(pathLabel, path, banIds) {
  if (!banIds?.length) {
    return;
  }

  return postAck(pathLabel, path, { banIds });
}

async function fetchPendingRoleSyncs() {
  return fetchPendingList(
    "pending-role-syncs",
    "/api/discord/pending-role-syncs"
  );
}

async function acknowledgeRoleSyncs(banIds) {
  return acknowledgeList(
    "acknowledge-role-syncs",
    "/api/discord/acknowledge-role-syncs",
    banIds
  );
}

async function fetchPendingRoleRemovals() {
  return fetchPendingList(
    "pending-role-removals",
    "/api/discord/pending-role-removals"
  );
}

const REMOVAL_SOURCE = {
  EVENT_BANS: "eventBans",
  PENDING_ROLE_REMOVALS: "pendingRoleRemovals"
};

function removalSourceForEntry(entry) {
  if (entry?.source === REMOVAL_SOURCE.PENDING_ROLE_REMOVALS) {
    return REMOVAL_SOURCE.PENDING_ROLE_REMOVALS;
  }

  return REMOVAL_SOURCE.EVENT_BANS;
}

function createRemovalAckQueue() {
  const banIds = [];
  const pendingRoleRemovalIds = [];

  return {
    push(entry) {
      const id = entry?._id;

      if (!id) {
        return;
      }

      if (
        removalSourceForEntry(entry) ===
        REMOVAL_SOURCE.PENDING_ROLE_REMOVALS
      ) {
        pendingRoleRemovalIds.push(id);
      } else {
        banIds.push(id);
      }
    },

    async flush() {
      if (!banIds.length && !pendingRoleRemovalIds.length) {
        return 0;
      }

      await acknowledgeRoleRemovals({ banIds, pendingRoleRemovalIds });

      return banIds.length + pendingRoleRemovalIds.length;
    }
  };
}

async function acknowledgeRoleRemovals({
  banIds = [],
  pendingRoleRemovalIds = []
} = {}) {
  if (!banIds.length && !pendingRoleRemovalIds.length) {
    return;
  }

  return postAck(
    "acknowledge-role-removals",
    "/api/discord/acknowledge-role-removals",
    { banIds, pendingRoleRemovalIds }
  );
}

module.exports = {
  REMOVAL_SOURCE,
  removalSourceForEntry,
  createRemovalAckQueue,
  fetchPendingRoleSyncs,
  acknowledgeRoleSyncs,
  fetchPendingRoleRemovals,
  acknowledgeRoleRemovals
};
