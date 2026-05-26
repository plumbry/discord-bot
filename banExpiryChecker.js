const {
  fetchPendingRoleSyncs,
  acknowledgeRoleSyncs,
  fetchPendingRoleRemovals,
  createRemovalAckQueue
} = require("./lib/discordBanApi");
const { getDiscordApiKey } = require("./lib/discordApi");
const { reconcileAddAndRemoveLists } = require("./lib/roleSyncDedupe");
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
  removeRolesForBanType
} = require("./lib/eventBanRoles");

const GUILD_ID =
  process.env.GUILD_ID || "1371615693392576580";

const POLL_MS = Number(process.env.ROLE_SYNC_POLL_MS || 30_000);

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

async function processPendingRoleSyncs(client) {
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

  try {
    do {
      syncPending = false;

      const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);

      if (!guild) {
        console.error("[ROLE SYNC] Guild not found:", GUILD_ID);
        return;
      }

      const [rawAdd, rawRemove] = await Promise.all([
        fetchPendingRoleSyncs(),
        fetchPendingRoleRemovals()
      ]);

      const { adds, removals } = reconcileAddAndRemoveLists(
        rawAdd,
        rawRemove
      );

      if (!adds.length && !removals.length) {
        return;
      }

      if (removals.length) {
        const removalAck = createRemovalAckQueue();

        const removal = await processPendingEntries(
          guild,
          removals,
          removeRolesForBanType,
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
    } while (syncPending);
  } catch (err) {
    console.error("[ROLE SYNC]", err?.message || err);
  } finally {
    syncRunning = false;
  }
}

function startBanExpiryChecker(client) {
  const cutoff = process.env.ROLE_SYNC_ONLY_AFTER?.trim();

  setTimeout(() => {
    processPendingRoleSyncs(client).catch(console.error);
  }, 15 * 1000);

  setInterval(() => {
    processPendingRoleSyncs(client).catch(console.error);
  }, POLL_MS);

  console.log(
    `[ROLE SYNC] Polling adds + removals every ${POLL_MS / 1000}s` +
      (cutoff ? ` (adds only on/after ${cutoff})` : "")
  );
}

module.exports = {
  startBanExpiryChecker,
  processPendingRoleSyncs,
  syncRolesFromSheet: processPendingRoleSyncs
};
