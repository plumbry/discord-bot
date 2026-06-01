/**
 * Normalize API pending lists so each ban _id is handled at most once per poll.
 */

const { rolesForBanType } = require("./eventBanRoles");

function dedupePendingById(pending) {
  const seen = new Set();
  const out = [];

  for (const entry of pending || []) {
    const id = entry?._id;

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    out.push(entry);
  }

  return out;
}

/**
 * If the same ban appears in both queues, removal wins by default — except an
 * event-ban assign from the site wins over removal (do not strip the role).
 */
function reconcileAddAndRemoveLists(toAdd, toRemove) {
  const removals = dedupePendingById(toRemove);
  const removalIds = new Set(removals.map(entry => entry._id));
  const adds = dedupePendingById(toAdd).filter(entry => {
    if (!removalIds.has(entry._id)) {
      return true;
    }

    return Boolean(rolesForBanType(entry.banType)?.eventBan);
  });
  const keptAddIds = new Set(adds.map(entry => entry._id));
  const filteredRemovals = removals.filter(entry => !keptAddIds.has(entry._id));

  return { adds, removals: filteredRemovals };
}

function dedupeIdList(ids) {
  return [...new Set((ids || []).filter(Boolean))];
}

module.exports = {
  dedupePendingById,
  reconcileAddAndRemoveLists,
  dedupeIdList
};
