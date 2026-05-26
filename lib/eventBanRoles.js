const EVENT_BAN_ROLE_ID = "1463660686231207956";
const PROBATION_ROLE_ID = "1432827886590496982";

const ROLE_BAN_TYPES = {
  "minor event ban": { eventBan: true, probation: false },
  "major event ban": { eventBan: true, probation: false },
  "event ban": { eventBan: true, probation: false },
  probation: { eventBan: false, probation: true }
};

function rolesForBanType(banType) {
  const key = (banType || "").trim().toLowerCase();

  return ROLE_BAN_TYPES[key] || null;
}

function parseDateGB(str) {
  if (!str) {
    return null;
  }

  const [d, m, y] = str.split("/").map(Number);

  if (!d || !m || !y) {
    return null;
  }

  return new Date(y, m - 1, d);
}

function normalizeType(row) {
  return (row?.[2] || "").trim().toLowerCase();
}

/** Offense log rows from the website — never get event ban role. */
function isOffenseRow(row) {
  return normalizeType(row).includes("offense");
}

function isProbationRow(row) {
  return normalizeType(row).includes("probation");
}

/** Active event ban: events remaining > 0, not an offense, not probation. */
function rowHasActiveEventBan(row) {
  if (!row?.[0]) {
    return false;
  }

  if (isOffenseRow(row) || isProbationRow(row)) {
    return false;
  }

  return Number(row[4] || 0) > 0;
}

function rowHasActiveProbation(row) {
  if (!row?.[0] || !isProbationRow(row)) {
    return false;
  }

  const daysRemaining = Number(row[4] || 0);

  if (daysRemaining > 0) {
    return true;
  }

  const endDate = parseDateGB(row[6]);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  return !!(endDate && endDate >= now);
}

function buildRoleTargets(rows) {
  const targets = new Map();

  for (const row of rows || []) {
    const userId = row[0];

    if (!userId) {
      continue;
    }

    const current = targets.get(userId) || {
      eventBan: false,
      probation: false
    };

    if (rowHasActiveEventBan(row)) {
      current.eventBan = true;
    }

    if (rowHasActiveProbation(row)) {
      current.probation = true;
    }

    targets.set(userId, current);
  }

  return targets;
}

function collectUserIdsToSync(guild, targets) {
  const userIds = new Set(targets.keys());

  const eventBanRole = guild.roles.cache.get(EVENT_BAN_ROLE_ID);
  const probationRole = guild.roles.cache.get(PROBATION_ROLE_ID);

  if (eventBanRole) {
    for (const memberId of eventBanRole.members.keys()) {
      userIds.add(memberId);
    }
  }

  if (probationRole) {
    for (const memberId of probationRole.members.keys()) {
      userIds.add(memberId);
    }
  }

  return userIds;
}

async function assignRolesForBanType(guild, discordId, banType) {
  const want = rolesForBanType(banType);

  if (!want) {
    return { ok: false, reason: "unknown_ban_type", banType };
  }

  const member = await guild.members.fetch(discordId).catch(() => null);

  if (!member) {
    return { ok: false, reason: "not_in_guild", discordId, banType };
  }

  let changed = false;

  if (want.eventBan && !member.roles.cache.has(EVENT_BAN_ROLE_ID)) {
    await member.roles.add(EVENT_BAN_ROLE_ID).catch(err => {
      console.error(
        "[EVENT BAN ROLE] add failed:",
        discordId,
        err?.message || err
      );
      throw err;
    });
    changed = true;
  }

  if (want.probation && !member.roles.cache.has(PROBATION_ROLE_ID)) {
    await member.roles.add(PROBATION_ROLE_ID).catch(err => {
      console.error(
        "[PROBATION ROLE] add failed:",
        discordId,
        err?.message || err
      );
      throw err;
    });
    changed = true;
  }

  return { ok: true, discordId, banType, changed, noop: !changed };
}

async function removeRolesForBanType(guild, discordId, banType) {
  const want = rolesForBanType(banType);

  if (!want) {
    return { ok: false, reason: "unknown_ban_type", banType };
  }

  const member = await guild.members.fetch(discordId).catch(() => null);

  if (!member) {
    return { ok: false, reason: "not_in_guild", discordId, banType };
  }

  let changed = false;

  if (want.eventBan && member.roles.cache.has(EVENT_BAN_ROLE_ID)) {
    await member.roles.remove(EVENT_BAN_ROLE_ID).catch(err => {
      console.error(
        "[EVENT BAN ROLE] remove failed:",
        discordId,
        err?.message || err
      );
      throw err;
    });
    changed = true;
  }

  if (want.probation && member.roles.cache.has(PROBATION_ROLE_ID)) {
    await member.roles.remove(PROBATION_ROLE_ID).catch(err => {
      console.error(
        "[PROBATION ROLE] remove failed:",
        discordId,
        err?.message || err
      );
      throw err;
    });
    changed = true;
  }

  return { ok: true, discordId, banType, changed, noop: !changed };
}

async function syncMemberRoles(guild, userId, want) {
  const member = await guild.members.fetch(userId).catch(() => null);

  if (!member) {
    return { userId, skipped: true };
  }

  const hasEventBan = member.roles.cache.has(EVENT_BAN_ROLE_ID);
  const hasProbation = member.roles.cache.has(PROBATION_ROLE_ID);

  if (want.eventBan && !hasEventBan) {
    await member.roles.add(EVENT_BAN_ROLE_ID).catch(err => {
      console.error("[EVENT BAN ROLE] add failed:", userId, err?.message || err);
    });
  }

  if (!want.eventBan && hasEventBan) {
    await member.roles.remove(EVENT_BAN_ROLE_ID).catch(err => {
      console.error("[EVENT BAN ROLE] remove failed:", userId, err?.message || err);
    });
  }

  if (want.probation && !hasProbation) {
    await member.roles.add(PROBATION_ROLE_ID).catch(err => {
      console.error("[PROBATION ROLE] add failed:", userId, err?.message || err);
    });
  }

  if (!want.probation && hasProbation) {
    await member.roles.remove(PROBATION_ROLE_ID).catch(err => {
      console.error("[PROBATION ROLE] remove failed:", userId, err?.message || err);
    });
  }

  return { userId, skipped: false };
}

async function syncDisciplineRolesFromSheet(guild, rows) {
  if (!guild) {
    return { synced: 0, skipped: 0 };
  }

  const targets = buildRoleTargets(rows);
  const userIds = collectUserIdsToSync(guild, targets);
  let synced = 0;
  let skipped = 0;

  for (const userId of userIds) {
    const want = targets.get(userId) || {
      eventBan: false,
      probation: false
    };
    const result = await syncMemberRoles(guild, userId, want);

    if (result.skipped) {
      skipped++;
    } else {
      synced++;
    }
  }

  return { synced, skipped, total: userIds.size };
}

function getSignupBlockReason(userId, rows) {
  for (const row of rows || []) {
    if (row[0] !== userId) {
      continue;
    }

    if (!rowHasActiveEventBan(row)) {
      continue;
    }

    return {
      kind: "event_ban",
      userId,
      tag: row[1],
      remaining: Number(row[4] || 0)
    };
  }

  return null;
}

function formatSignupBlockMessage(block) {
  if (!block) {
    return "";
  }

  const mention = block.userId
    ? `<@${block.userId}>`
    : (block.tag || "User");

  return (
    `${mention} has an active event ban ` +
    `(${block.remaining} event(s) remaining).`
  );
}

function describeUserStatus(userId, rows) {
  let eventBan = null;
  let probation = null;
  let offenses = [];

  for (const row of rows || []) {
    if (row[0] !== userId) {
      continue;
    }

    if (isOffenseRow(row)) {
      offenses.push({
        type: row[2],
        reason: row[7]
      });
      continue;
    }

    if (rowHasActiveProbation(row)) {
      probation = {
        type: row[2],
        remaining: row[4],
        ends: row[6]
      };
      continue;
    }

    if (rowHasActiveEventBan(row)) {
      eventBan = {
        type: row[2],
        remaining: row[4]
      };
    }
  }

  return { eventBan, probation, offenses };
}

module.exports = {
  EVENT_BAN_ROLE_ID,
  PROBATION_ROLE_ID,
  ROLE_BAN_TYPES,
  rolesForBanType,
  assignRolesForBanType,
  removeRolesForBanType,
  isOffenseRow,
  isProbationRow,
  rowHasActiveEventBan,
  rowHasActiveProbation,
  buildRoleTargets,
  syncDisciplineRolesFromSheet,
  getSignupBlockReason,
  formatSignupBlockMessage,
  describeUserStatus
};
