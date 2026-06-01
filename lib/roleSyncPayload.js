const { reconcileAddAndRemoveLists } = require("./roleSyncDedupe");

function firstPresent(entry, keys) {
  for (const key of keys) {
    const value = entry?.[key];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return undefined;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }

  return {
    ...entry,
    _id: firstPresent(entry, [
      "_id",
      "id",
      "banId",
      "ban_id",
      "documentId",
      "document_id"
    ]),
    discordId: String(
      firstPresent(entry, [
        "discordId",
        "discord_id",
        "userId",
        "user_id",
        "playerDiscordId",
        "player_discord_id"
      ]) || ""
    ).trim(),
    banType: String(
      firstPresent(entry, [
        "banType",
        "ban_type",
        "type",
        "roleType",
        "role_type"
      ]) || ""
    ).trim()
  };
}

function normalizeEntries(entries) {
  return (entries || []).map(normalizeEntry);
}

function isRemovalAction(action) {
  const normalized = String(action || "").trim().toLowerCase();

  return ["remove", "removal", "delete", "clear", "unassign"].includes(
    normalized
  );
}

function parseRoleSyncPayload(body) {
  if (!body || typeof body !== "object") {
    return { adds: [], removals: [] };
  }

  let adds = [];
  let removals = [];

  if (Array.isArray(body.entries) && body.entries.length) {
    if (isRemovalAction(body.action)) {
      removals = normalizeEntries(body.entries);
    } else {
      adds = normalizeEntries(body.entries);
    }
  }

  if (Array.isArray(body.adds)) {
    adds = adds.concat(normalizeEntries(body.adds));
  }

  if (Array.isArray(body.removals)) {
    removals = removals.concat(normalizeEntries(body.removals));
  }

  return reconcileAddAndRemoveLists(adds, removals);
}

function payloadHasEntries(body) {
  if (!body || typeof body !== "object") {
    return false;
  }

  return (
    (Array.isArray(body.entries) && body.entries.length > 0) ||
    (Array.isArray(body.adds) && body.adds.length > 0) ||
    (Array.isArray(body.removals) && body.removals.length > 0)
  );
}

module.exports = {
  normalizeEntry,
  parseRoleSyncPayload,
  payloadHasEntries
};
