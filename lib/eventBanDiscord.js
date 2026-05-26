const {
  EVENT_BAN_ROLE_ID,
  PROBATION_ROLE_ID,
  rowHasActiveEventBan,
  syncDisciplineRolesFromSheet,
  syncMemberRoles,
  buildRoleTargets
} = require("./eventBanRoles");

const EVENT_BAN_TYPE_LABEL = "Event Ban";

/** @deprecated Use syncDisciplineRolesFromSheet */
async function syncEventBanRole(guild, userId, rows) {
  const targets = buildRoleTargets(rows);
  const want = targets.get(userId) || { eventBan: false, probation: false };

  await syncMemberRoles(guild, userId, want);
}

function userHasActiveEventBan(rows, userId) {
  return (rows || []).some(
    row => row[0] === userId && rowHasActiveEventBan(row)
  );
}

module.exports = {
  EVENT_BAN_ROLE_ID,
  PROBATION_ROLE_ID,
  EVENT_BAN_TYPE_LABEL,
  userHasActiveEventBan,
  syncEventBanRole,
  syncDisciplineRolesFromSheet
};
