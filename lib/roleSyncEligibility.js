const {
  hasProcessedAdd,
  hasProcessedRemoval
} = require("./roleSyncHistory");

function parseEntryTime(entry) {
  const raw =
    entry?.roleSyncRequestedAt ||
    entry?.syncRequestedAt ||
    entry?.createdAt ||
    entry?.created_at ||
    entry?.startedAt ||
    entry?.startDate;

  if (!raw) {
    return null;
  }

  const date = new Date(raw);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getRoleSyncCutoff() {
  const raw = process.env.ROLE_SYNC_ONLY_AFTER?.trim();

  if (!raw) {
    return null;
  }

  const date = new Date(raw);

  return Number.isNaN(date.getTime()) ? null : date;
}

function isExplicitlyNotPending(entry) {
  if (entry?.eligibleForRoleSync === false) {
    return true;
  }

  if (entry?.roleSyncPending === false) {
    return true;
  }

  if (entry?.needsRoleSync === false) {
    return true;
  }

  return false;
}

/**
 * Whether this add entry should receive Discord roles.
 * Old / backfill / already-handled rows are ack-only.
 */
function evaluateRoleAdd(entry) {
  const banId = entry?._id;

  if (!banId) {
    return { apply: false, reason: "missing_id", ack: false };
  }

  if (hasProcessedAdd(banId)) {
    return { apply: false, reason: "already_processed", ack: true };
  }

  if (isExplicitlyNotPending(entry)) {
    return { apply: false, reason: "not_pending", ack: true };
  }

  const cutoff = getRoleSyncCutoff();
  const entryTime = parseEntryTime(entry);

  // Pending-role-syncs entries without a date are trusted as new (website queued them).
  // Only skip when an explicit timestamp proves the ban is before the cutoff.
  if (cutoff && entryTime && entryTime < cutoff) {
    return { apply: false, reason: "old_before_cutoff", ack: true };
  }

  if (entry?.isLegacy === true || entry?.legacy === true) {
    return { apply: false, reason: "legacy", ack: true };
  }

  return { apply: true, reason: "eligible", ack: false };
}

/**
 * Removals still run for ended old bans; skip only if already handled.
 */
function evaluateRoleRemoval(entry) {
  const banId = entry?._id;

  if (!banId) {
    return { apply: false, reason: "missing_id", ack: false };
  }

  if (hasProcessedRemoval(banId)) {
    return { apply: false, reason: "already_processed", ack: true };
  }

  if (entry?.eligibleForRoleRemoval === false) {
    return { apply: false, reason: "not_pending", ack: true };
  }

  return { apply: true, reason: "eligible", ack: false };
}

module.exports = {
  parseEntryTime,
  getRoleSyncCutoff,
  evaluateRoleAdd,
  evaluateRoleRemoval
};
