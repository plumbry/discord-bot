const {
  fetchPendingRoleSyncs,
  acknowledgeRoleSyncs,
  fetchPendingRoleRemovals,
  createRemovalAckQueue
} = require("./lib/discordBanApi");
const { getDiscordApiKey } = require("./lib/discordApi");
const { reconcileAddAndRemoveLists } = require("./lib/roleSyncDedupe");
const {
  parseRoleSyncPayload,
  payloadHasEntries
} = require("./lib/roleSyncPayload");
const {
  evaluateRoleAdd,
  evaluateRoleRemoval
} = require("./lib/roleSyncEligibility");
const {
  markProcessedAdd,
  markProcessedRemoval
} = require("./lib/roleSyncHistory");
const {
  assignRolesForBanType,
  removeRolesForBanType,
  isEventBanBanType
} = require("./lib/eventBanRoles");
const { getEventBanRows } = require("./lib/eventBanSheet");
const { userHasActiveEventBan } = require("./lib/eventBanDiscord");

const GUILD_ID =
  process.env.GUILD_ID || "1371615693392576580";

function getFallbackPollMs() {
  if (process.env.ROLE_SYNC_FALLBACK_POLL_MS !== undefined) {
    return Number(process.env.ROLE_SYNC_FALLBACK_POLL_MS);
  }

  if (process.env.ROLE_SYNC_POLL_MS !== undefined) {
    console.warn(
      "[ROLE SYNC] ROLE_SYNC_POLL_MS is deprecated; use ROLE_SYNC_FALLBACK_POLL_MS"
    );
    return Number(process.env.ROLE_SYNC_POLL_MS);
  }

  return 0;
}

let syncRunning = false;
let syncPending = false;

const inFlightBanIds = new Set();

function claimBanId(banId) {
  if (!banId || inFlightBanIds.has(banId)) {
    return false;
  }

  inFlightBanIds.add(banId);
  return true;
}

function releaseBanId(banId) {
  if (banId) {
    inFlightBanIds.delete(banId);
  }
}

async function processPendingEntries(
  guild,
  pending,
  applyFn,
  acknowledgeEntry,
  evaluateFn,
  markProcessedFn,
  logLabel
) {
  let applied = 0;
  let noop = 0;
  let skipped = 0;
  let failed = 0;
  let acknowledged = 0;
  let clearedOld = 0;

  for (const entry of pending) {
    const banId = entry._id;
    const discordId = entry.discordId;
    const banType = entry.banType;

    if (!banId || !discordId || !banType) {
      console.warn(
        `[ROLE SYNC] Skipped malformed ${logLabel} entry: ` +
          JSON.stringify({
            hasId: Boolean(banId),
            hasDiscordId: Boolean(discordId),
            hasBanType: Boolean(banType),
            keys: entry && typeof entry === "object" ? Object.keys(entry) : []
          })
      );
      skipped++;
      continue;
    }

    if (!claimBanId(banId)) {
      console.warn(
        `[ROLE SYNC] Skip duplicate in-flight ${banId} (${logLabel})`
      );
      skipped++;
      continue;
    }

    try {
      const eligibility = evaluateFn(entry);

      if (!eligibility.apply) {
        if (eligibility.ack) {
          await acknowledgeEntry(entry);
          markProcessedFn(banId);
          acknowledged++;
          clearedOld++;

          console.log(
            `[ROLE SYNC] ${logLabel} ack only ${banId} — ${eligibility.reason} (${banType})`
          );
        } else {
          skipped++;
          console.warn(
            `[ROLE SYNC] Skipped ${banId}: ${eligibility.reason}`
          );
        }

        continue;
      }

      const result = await applyFn(guild, discordId, banType);

      if (result.ok) {
        if (result.noop) {
          noop++;
        } else {
          applied++;
        }

        await acknowledgeEntry(entry);
        markProcessedFn(banId);
        acknowledged++;

        console.log(
          `[ROLE SYNC] ${logLabel} ${discordId} — ${banType} (${banId})` +
            (result.noop ? " [already set]" : "")
        );
      } else {
        skipped++;

        if (result.reason === "not_in_guild") {
          await acknowledgeEntry(entry);
          markProcessedFn(banId);
          acknowledged++;
          console.warn(
            `[ROLE SYNC] ${discordId} not in guild — ack ${banId}`
          );
        } else {
          console.warn(
            `[ROLE SYNC] Skipped ${banId}: ${result.reason} (${banType})`
          );
        }
      }
    } catch (err) {
      failed++;
      console.error(
        `[ROLE SYNC] Failed ${logLabel} ${banId} (${discordId}, ${banType}):`,
        err?.message || err
      );
    } finally {
      releaseBanId(banId);
    }
  }

  return {
    applied,
    noop,
    skipped,
    failed,
    acknowledged,
    clearedOld
  };
}

function buildEventBanPreserveContext(adds, sheetRows) {
  const eventBanAddUsers = new Set();

  for (const entry of adds || []) {
    if (isEventBanBanType(entry.banType) && entry.discordId) {
      eventBanAddUsers.add(entry.discordId);
    }
  }

  return { eventBanAddUsers, sheetRows: sheetRows || [] };
}

function createRemoveRolesFn(preserveContext) {
  const { eventBanAddUsers, sheetRows } = preserveContext;

  return async function removeRolesWithPreserve(guild, discordId, banType) {
    const preserveEventBanRole =
      isEventBanBanType(banType) &&
      (eventBanAddUsers.has(discordId) ||
        userHasActiveEventBan(sheetRows, discordId));

    return removeRolesForBanType(guild, discordId, banType, {
      preserveEventBanRole
    });
  };
}

async function applyRoleSyncLists(client, adds, removals, { source = "unknown" } = {}) {
  const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);

  if (!guild) {
    console.error("[ROLE SYNC] Guild not found:", GUILD_ID);
    return;
  }

  if (!adds.length && !removals.length) {
    return;
  }

  console.log(
    `[ROLE SYNC] Applying ${adds.length} add(s), ${removals.length} removal(s) ` +
      `(source: ${source})`
  );

  const sheetRows =
    adds.length || removals.some(entry => isEventBanBanType(entry.banType))
      ? await getEventBanRows().catch(() => [])
      : [];

  const preserveContext = buildEventBanPreserveContext(adds, sheetRows);

  if (adds.length) {
    const addition = await processPendingEntries(
      guild,
      adds,
      assignRolesForBanType,
      entry => acknowledgeRoleSyncs([entry._id]),
      evaluateRoleAdd,
      markProcessedAdd,
      "added"
    );

    console.log(
      `[ROLE SYNC] ${adds.length} assignment(s) — ` +
        `${addition.applied} added, ${addition.noop} already on, ` +
        `${addition.clearedOld} ack-only (old/already done), ` +
        `${addition.skipped} skipped, ${addition.failed} failed, ` +
        `${addition.acknowledged} acknowledged`
    );
  }

  if (removals.length) {
    const removalAck = createRemovalAckQueue();
    const removeRolesFn = createRemoveRolesFn(preserveContext);

    const removal = await processPendingEntries(
      guild,
      removals,
      removeRolesFn,
      entry => {
        removalAck.push(entry);
      },
      evaluateRoleRemoval,
      markProcessedRemoval,
      "removed"
    );

    await removalAck.flush();

    console.log(
      `[ROLE SYNC] ${removals.length} removal(s) — ` +
        `${removal.applied} removed, ${removal.noop} already off, ` +
        `${removal.clearedOld} ack-only, ` +
        `${removal.skipped} skipped, ${removal.failed} failed, ` +
        `${removal.acknowledged} acknowledged`
    );
  }
}

async function runRoleSyncCycle(client, options = {}) {
  const {
    fetch = false,
    adds: inputAdds = [],
    removals: inputRemovals = [],
    source = fetch ? "fallback-poll" : "push"
  } = options;

  if (syncRunning) {
    syncPending = true;
    return;
  }

  if (!getDiscordApiKey()) {
    console.warn(
      "[ROLE SYNC] DISCORD_SYNC_API_KEY (or EVENT_BAN_WEBHOOK_SECRET) not set — skipping"
    );
    return;
  }

  syncRunning = true;

  let shouldFetch = fetch;
  let applySource = source;

  try {
    do {
      syncPending = false;

      let adds = [];
      let removals = [];

      if (shouldFetch) {
        const [rawAdd, rawRemove] = await Promise.all([
          fetchPendingRoleSyncs(),
          fetchPendingRoleRemovals()
        ]);

        ({ adds, removals } = reconcileAddAndRemoveLists(rawAdd, rawRemove));

        if (adds.length || removals.length) {
          console.warn(
            `[ROLE SYNC] Poll found ${adds.length} add(s), ` +
              `${removals.length} removal(s)` +
              (source === "push"
                ? " — check push delivery if unexpected"
                : "")
          );
        }
      } else {
        ({ adds, removals } = reconcileAddAndRemoveLists(
          inputAdds,
          inputRemovals
        ));
      }

      if (!adds.length && !removals.length) {
        return;
      }

      await applyRoleSyncLists(client, adds, removals, { source: applySource });

      if (syncPending && !fetch) {
        shouldFetch = true;
        applySource = "poll";
      }
    } while (syncPending);
  } catch (err) {
    console.error("[ROLE SYNC]", err?.message || err);
  } finally {
    syncRunning = false;
  }
}

async function processPendingRoleSyncs(client) {
  return runRoleSyncCycle(client, { fetch: true, source: "poll" });
}

async function processRoleSyncPayload(client, body, meta = {}) {
  if (!payloadHasEntries(body)) {
    console.log(
      `[ROLE SYNC] Webhook without entries — running fallback poll ` +
        `(source: ${meta.source || "unknown"})`
    );
    return processPendingRoleSyncs(client);
  }

  const { adds, removals } = parseRoleSyncPayload(body);

  return runRoleSyncCycle(client, {
    fetch: false,
    adds,
    removals,
    source: meta.source || body.source || "push"
  });
}

function startBanExpiryChecker(client) {
  const cutoff = process.env.ROLE_SYNC_ONLY_AFTER?.trim();
  const fallbackMs = getFallbackPollMs();

  processPendingRoleSyncs(client).catch(err => {
    console.error("[ROLE SYNC] startup drain failed:", err);
  });

  if (fallbackMs > 0) {
    setInterval(() => {
      processPendingRoleSyncs(client).catch(console.error);
    }, fallbackMs);

    console.log(
      `[ROLE SYNC] Push-driven sync enabled; fallback poll every ${fallbackMs / 1000}s` +
        (cutoff ? ` (adds only on/after ${cutoff})` : "")
    );
  } else {
    console.log(
      "[ROLE SYNC] Push-driven sync enabled; fallback poll disabled " +
        "(startup drain + manual /eventban sync only)" +
        (cutoff ? ` (adds only on/after ${cutoff})` : "")
    );
  }
}

module.exports = {
  startBanExpiryChecker,
  processPendingRoleSyncs,
  processRoleSyncPayload,
  parseRoleSyncPayload,
  payloadHasEntries,
  syncRolesFromSheet: processPendingRoleSyncs
};
