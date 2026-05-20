const EVENT_BAN_ROLE_ID = "1463660686231207956";
const EVENT_BAN_TYPE_LABEL = "Event Ban";

function userHasActiveEventBan(rows, userId) {

  return rows.some(row =>
    row[0] === userId &&
    row[2] !== "Probation" &&
    Number(row[4] || 0) > 0
  );

}

async function syncEventBanRole(guild, userId, rows) {

  if (!guild) {
    return;
  }

  const member =
    await guild.members.fetch(userId).catch(() => null);

  if (!member) {
    return;
  }

  const shouldHaveRole =
    userHasActiveEventBan(rows, userId);

  const hasRole =
    member.roles.cache.has(EVENT_BAN_ROLE_ID);

  if (shouldHaveRole && !hasRole) {

    await member.roles.add(EVENT_BAN_ROLE_ID).catch(err => {
      console.error("[EVENT BAN ROLE] add failed:", err);
    });

  }

  if (!shouldHaveRole && hasRole) {

    await member.roles.remove(EVENT_BAN_ROLE_ID).catch(err => {
      console.error("[EVENT BAN ROLE] remove failed:", err);
    });

  }

}

module.exports = {
  EVENT_BAN_ROLE_ID,
  EVENT_BAN_TYPE_LABEL,
  userHasActiveEventBan,
  syncEventBanRole
};
