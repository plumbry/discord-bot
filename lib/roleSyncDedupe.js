/**
 * Normalize API pending lists so each ban _id is handled at most once per poll.
 */

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
 * If the same ban appears in both queues, removal wins (ended/expired state).
 * Also drops duplicate _ids within each list.
 */
function reconcileAddAndRemoveLists(toAdd, toRemove) {
  const removals = dedupePendingById(toRemove);
  const removalIds = new Set(removals.map(entry => entry._id));
  const adds = dedupePendingById(toAdd).filter(
    entry => !removalIds.has(entry._id)
  );

  return { adds, removals };
}

function dedupeIdList(ids) {
  return [...new Set((ids || []).filter(Boolean))];
}

module.exports = {
  dedupePendingById,
  reconcileAddAndRemoveLists,
  dedupeIdList
};
