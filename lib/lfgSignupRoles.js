const { GuildScheduledEventStatus } = require("discord.js");
const { resolveWhenBucket } = require("./lfgParser");

/** Event name (normalized) → role name or role ID. Env: LFG_SIGNUP_ROLE_OVERRIDES JSON. */
const DEFAULT_EVENT_ROLE_OVERRIDES = {
  "1 gun trios": "event role"
};

function normalizeName(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isAssignableRole(role, guildId) {
  return role && !role.managed && role.id !== guildId;
}

function parseEventRoleOverrides() {
  const merged = { ...DEFAULT_EVENT_ROLE_OVERRIDES };
  const raw = process.env.LFG_SIGNUP_ROLE_OVERRIDES?.trim();

  if (!raw) {
    return merged;
  }

  try {
    const parsed = JSON.parse(raw);

    for (const [eventName, roleRef] of Object.entries(parsed)) {
      merged[normalizeName(eventName)] = String(roleRef).trim();
    }
  } catch (err) {
    console.warn("[LFG] Invalid LFG_SIGNUP_ROLE_OVERRIDES:", err.message);
  }

  return merged;
}

const EVENT_ROLE_OVERRIDES = parseEventRoleOverrides();

function resolveRoleRef(guild, ref) {
  if (!ref) {
    return null;
  }

  const trimmed = String(ref).trim();

  if (/^\d{17,20}$/.test(trimmed)) {
    const byId = guild.roles.cache.get(trimmed);
    return isAssignableRole(byId, guild.id) ? byId : null;
  }

  const targetNorm = normalizeName(trimmed);

  for (const role of guild.roles.cache.values()) {
    if (
      isAssignableRole(role, guild.id) &&
      normalizeName(role.name) === targetNorm
    ) {
      return role;
    }
  }

  return null;
}

/**
 * Match a guild role to a scheduled event (override map, name match, or today's fallback role).
 */
function findSignupRoleForEvent(guild, event, { whenSortKey } = {}) {
  if (!event?.name) {
    return null;
  }

  const eventNorm = normalizeName(event.name);
  const overrideRef = EVENT_ROLE_OVERRIDES[eventNorm];

  if (overrideRef) {
    const overrideRole = resolveRoleRef(guild, overrideRef);

    if (overrideRole) {
      return overrideRole;
    }
  }

  const roles = guild.roles.cache.filter(role =>
    isAssignableRole(role, guild.id)
  );

  for (const role of roles.values()) {
    if (normalizeName(role.name) === eventNorm) {
      return role;
    }
  }

  let best = null;
  let bestLen = 0;

  for (const role of roles.values()) {
    const roleNorm = normalizeName(role.name);

    if (!roleNorm || !eventNorm.includes(roleNorm)) {
      continue;
    }

    if (roleNorm.length > bestLen) {
      best = role;
      bestLen = roleNorm.length;
    }
  }

  if (best) {
    return best;
  }

  for (const role of roles.values()) {
    const roleNorm = normalizeName(role.name);

    if (roleNorm && roleNorm.includes(eventNorm)) {
      return role;
    }
  }

  if (whenSortKey === 0) {
    const todayFallback =
      process.env.LFG_TODAY_SIGNUP_ROLE_NAME?.trim() || "event role";

    return resolveRoleRef(guild, todayFallback);
  }

  return null;
}

function isActiveScheduledEvent(event) {
  return (
    event.status !== GuildScheduledEventStatus.Completed &&
    event.status !== GuildScheduledEventStatus.Cancelled
  );
}

/**
 * Map whenSortKey (0=today) → signup role from that day's scheduled event.
 */
function buildSignupRolesByDay(guild, scheduledEvents, referenceNow = new Date()) {
  const sorted = [...scheduledEvents]
    .filter(event => event.scheduledStartAt && isActiveScheduledEvent(event))
    .sort(
      (a, b) =>
        a.scheduledStartAt.getTime() - b.scheduledStartAt.getTime()
    );

  /** @type {Map<number, { role: import("discord.js").Role, eventName: string, whenLabel: string }>} */
  const byDay = new Map();

  for (const event of sorted) {
    const bucket = resolveWhenBucket(
      event.scheduledStartAt.getTime(),
      referenceNow
    );

    if (!bucket || byDay.has(bucket.whenSortKey)) {
      continue;
    }

    const role = findSignupRoleForEvent(guild, event, {
      whenSortKey: bucket.whenSortKey
    });

    if (role) {
      byDay.set(bucket.whenSortKey, {
        role,
        eventName: event.name,
        whenLabel: bucket.label
      });
    }
  }

  return byDay;
}

function formatSignupRoleSummary(signupRolesByDay) {
  if (signupRolesByDay.size === 0) {
    return (
      "No signup roles matched. Use event name = role name, or set " +
      "`LFG_SIGNUP_ROLE_OVERRIDES` / today's fallback `LFG_TODAY_SIGNUP_ROLE_NAME` (default: event role)."
    );
  }

  const lines = [...signupRolesByDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([, entry]) =>
        `**${entry.whenLabel}** → ${entry.role.name} (${entry.eventName})`
    );

  return `Signup roles (from scheduled events): ${lines.join(" · ")}`;
}

module.exports = {
  findSignupRoleForEvent,
  buildSignupRolesByDay,
  formatSignupRoleSummary
};
