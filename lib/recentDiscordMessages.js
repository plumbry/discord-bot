const { PermissionFlagsBits, ChannelType } = require("discord.js");

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_CHANNEL = Math.max(
  1,
  Number(process.env.PRUNE_MESSAGE_MAX_PAGES || 80)
);
const CHANNEL_CONCURRENCY = Math.max(
  1,
  Number(process.env.PRUNE_MESSAGE_CHANNEL_CONCURRENCY || 2)
);
const CACHE_TTL_MS = Number(
  process.env.PRUNE_MESSAGE_CACHE_TTL_MS || 5 * 60 * 1000
);
const ARCHIVED_THREAD_LIMIT = 25;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

let scanCache = null;

function cacheKey(guildId, minAgeDays) {
  return `${guildId}:${minAgeDays}`;
}

function canReadHistory(channel, me) {
  if (!me || typeof channel.permissionsFor !== "function") {
    return Boolean(channel.messages?.fetch);
  }

  const permissions = channel.permissionsFor(me);

  if (!permissions) {
    return false;
  }

  return (
    permissions.has(PermissionFlagsBits.ViewChannel) &&
    permissions.has(PermissionFlagsBits.ReadMessageHistory)
  );
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) || 0 },
    worker
  );

  await Promise.all(workers);
  return results;
}

async function collectScanChannels(guild, sinceMs) {
  const byId = new Map();

  const add = channel => {
    if (
      channel &&
      !byId.has(channel.id) &&
      channel.isTextBased?.() &&
      !channel.isDMBased?.() &&
      typeof channel.messages?.fetch === "function"
    ) {
      byId.set(channel.id, channel);
    }
  };

  try {
    await guild.channels.fetch();
  } catch (err) {
    console.warn("[PRUNE] Channel list fetch failed:", err?.message || err);
  }

  for (const channel of guild.channels.cache.values()) {
    add(channel);
  }

  try {
    const active = await guild.channels.fetchActiveThreads();
    for (const thread of active.threads.values()) {
      add(thread);
    }
  } catch (err) {
    console.warn("[PRUNE] Active thread fetch failed:", err?.message || err);
  }

  const parents = [...guild.channels.cache.values()].filter(
    channel =>
      channel.type === ChannelType.GuildForum ||
      channel.type === ChannelType.GuildMedia
  );

  for (const parent of parents) {
    try {
      const archived = await parent.threads.fetchArchived({
        fetchAll: false,
        limit: ARCHIVED_THREAD_LIMIT
      });

      for (const thread of archived.threads.values()) {
        if (thread.archiveTimestamp && thread.archiveTimestamp < sinceMs) {
          continue;
        }
        add(thread);
      }
    } catch (err) {
      console.warn(
        `[PRUNE] Archived thread fetch failed for ${parent.id}:`,
        err?.message || err
      );
    }
  }

  return [...byId.values()];
}

async function scanChannelMessages(channel, sinceMs, lastByUser) {
  let before;
  let pages = 0;

  while (pages < MAX_PAGES_PER_CHANNEL) {
    const options = { limit: PAGE_SIZE, cache: false };

    if (before) {
      options.before = before;
    }

    const batch = await channel.messages.fetch(options);
    pages++;

    if (batch.size === 0) {
      return;
    }

    const messages = [...batch.values()].sort(
      (a, b) => b.createdTimestamp - a.createdTimestamp
    );
    let reachedCutoff = false;

    for (const message of messages) {
      if (message.createdTimestamp < sinceMs) {
        reachedCutoff = true;
        break;
      }

      const author = message.author;
      if (!author || author.bot) {
        continue;
      }

      const previous = lastByUser.get(author.id);
      if (!previous || message.createdTimestamp > previous) {
        lastByUser.set(author.id, message.createdTimestamp);
      }
    }

    const oldest = messages[messages.length - 1];
    if (reachedCutoff || !oldest || oldest.createdTimestamp < sinceMs) {
      return;
    }

    if (batch.size < PAGE_SIZE) {
      return;
    }

    before = oldest.id;
    await delay(150);
  }
}

function emptyResult(complete) {
  return {
    ids: new Set(),
    lastByUser: new Map(),
    complete,
    channelCount: 0,
    scannedChannels: 0,
    failedChannels: 0
  };
}

async function loadRecentMessageUserIds(guild, options = {}) {
  const minAgeDays = Math.max(1, Number(options.minAgeDays || 30));
  const now = options.now || Date.now();
  const sinceMs = now - minAgeDays * MS_PER_DAY;

  if (!guild) {
    return emptyResult(false);
  }

  const key = cacheKey(guild.id, minAgeDays);

  if (
    scanCache &&
    scanCache.key === key &&
    Date.now() - scanCache.loadedAt < CACHE_TTL_MS
  ) {
    return scanCache.result;
  }

  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  const channels = await collectScanChannels(guild, sinceMs);
  const readable = channels.filter(channel => canReadHistory(channel, me));
  const lastByUser = new Map();
  let scannedChannels = 0;
  let failedChannels = 0;

  await mapPool(readable, CHANNEL_CONCURRENCY, async channel => {
    try {
      await scanChannelMessages(channel, sinceMs, lastByUser);
      scannedChannels++;
    } catch (err) {
      failedChannels++;
      console.warn(
        `[PRUNE] Message scan failed for #${channel.name || channel.id}:`,
        err?.message || err
      );
    }
  });

  const complete = scannedChannels > 0 || channels.length === 0;

  const result = {
    ids: new Set(lastByUser.keys()),
    lastByUser,
    complete,
    channelCount: readable.length,
    scannedChannels,
    failedChannels
  };

  scanCache = { key, loadedAt: Date.now(), result };
  return result;
}

module.exports = {
  loadRecentMessageUserIds
};
