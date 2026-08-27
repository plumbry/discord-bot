const { PermissionFlagsBits } = require("discord.js");

const { userIsStaff } = require("./staffPermissions");
const { listKnownLfgUserIds } = require("./lfgSheet");
const { listEntries, sheetsConfigured: anonqConfigured } = require("./anonqSheet");
const { getEventBanRows } = require("./eventBanSheet");
const { isGirlVerifiedOnSheet } = require("./girlRoleSheet");
const { isOnGenderEvalSheet } = require("./genderEvalSheet");
const {
  loadYuniteSnapshot,
  getTournamentStatus,
  getYuniteApiKey
} = require("./yuniteTournamentData");

const LOG_CHANNEL_ID =
  process.env.BOT_STATUS_CHANNEL_ID || "1471082166535454780";
const AUDIT_RANGE = "Audit Log!A:G";

const EVENT_BAN_ROLE_ID =
  process.env.EVENT_BAN_ROLE_ID || "1463660686231207956";
const PROBATION_ROLE_ID =
  process.env.PROBATION_ROLE_ID || "1432827886590496982";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseRoleIdList(raw) {
  return String(raw || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function defaultProtectedRoleIds() {
  return new Set([
    ...parseRoleIdList(process.env.STAFF_ROLE_ID),
    ...parseRoleIdList(process.env.ADMIN_ROLE_ID),
    ...parseRoleIdList(process.env.PRUNE_PROTECTED_ROLE_IDS),
    EVENT_BAN_ROLE_ID,
    PROBATION_ROLE_ID
  ]);
}

function memberHasProtectedPermission(member) {
  const permissions = member.permissions;

  if (!permissions) {
    return false;
  }

  return (
    permissions.has(PermissionFlagsBits.Administrator) ||
    permissions.has(PermissionFlagsBits.ManageRoles) ||
    permissions.has(PermissionFlagsBits.KickMembers) ||
    permissions.has(PermissionFlagsBits.BanMembers) ||
    permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

function getProtectedReason(member, extraProtectedIds, invokerId) {
  if (member.user?.bot) {
    return "Bot account";
  }

  if (member.id === member.guild?.ownerId) {
    return "Server owner";
  }

  if (invokerId && member.id === invokerId) {
    return "Command invoker";
  }

  if (memberHasProtectedPermission(member) || userIsStaff(member)) {
    return "Staff / admin permission";
  }

  const protectedIds = extraProtectedIds || defaultProtectedRoleIds();

  for (const roleId of protectedIds) {
    if (member.roles?.cache?.has(roleId)) {
      const role = member.roles.cache.get(roleId);
      return `Protected role (${role?.name || roleId})`;
    }
  }

  return null;
}

function getJoinAgeDays(member, now = Date.now()) {
  if (!member.joinedTimestamp) {
    return null;
  }

  return Math.floor((now - member.joinedTimestamp) / MS_PER_DAY);
}

async function loadStoredActivityUserIds() {
  const ids = new Set();
  const errors = [];

  try {
    const lfgIds = await listKnownLfgUserIds();
    for (const id of lfgIds) {
      if (id) {
        ids.add(String(id));
      }
    }
  } catch (err) {
    errors.push("lfg");
    console.error("[PRUNE] LFG activity load failed:", err?.message || err);
  }

  if (anonqConfigured()) {
    try {
      const entries = await listEntries();
      for (const entry of entries) {
        if (entry?.userId) {
          ids.add(String(entry.userId));
        }
      }
    } catch (err) {
      errors.push("anonq");
      console.error("[PRUNE] AnonQ activity load failed:", err?.message || err);
    }
  }

  try {
    const rows = await getEventBanRows();
    for (const row of rows) {
      const id = String(row?.[0] || "").trim();
      if (/^\d{17,20}$/.test(id)) {
        ids.add(id);
      }
    }
  } catch (err) {
    errors.push("event_bans");
    console.error("[PRUNE] Event ban activity load failed:", err?.message || err);
  }

  return { ids, complete: errors.length === 0, errors };
}

async function getInteractionRecord(member, activityIds) {
  if (activityIds.has(member.id)) {
    return { found: true, reason: "Stored bot activity (LFG, AnonQ, or event bans)" };
  }

  try {
    if (await isGirlVerifiedOnSheet(member.id)) {
      return { found: true, reason: "Girl verification sheet" };
    }
  } catch (err) {
    console.error("[PRUNE] Girl sheet lookup failed:", err?.message || err);
  }

  try {
    if (await isOnGenderEvalSheet(member.id)) {
      return { found: true, reason: "Gender evaluation sheet" };
    }
  } catch (err) {
    console.error("[PRUNE] Gender sheet lookup failed:", err?.message || err);
  }

  return { found: false, reason: "No stored bot activity found" };
}

async function classifyMember(member, options) {
  const {
    now,
    minAgeDays,
    activityIds,
    activityComplete,
    snapshot,
    invokerId,
    protectedRoleIds
  } = options;

  const username =
    member.user?.username || member.displayName || member.id;
  const joinedTimestamp = member.joinedTimestamp || null;
  const ageDays = getJoinAgeDays(member, now);
  const protectedReason = getProtectedReason(
    member,
    protectedRoleIds,
    invokerId
  );
  const tournament = getTournamentStatus(member.id, snapshot);
  const interaction = await getInteractionRecord(member, activityIds);

  const record = {
    id: member.id,
    username,
    tag: member.user?.tag || username,
    joinedTimestamp,
    ageDays,
    bot: Boolean(member.user?.bot),
    kickable: Boolean(member.kickable),
    protected: Boolean(protectedReason),
    protectedReason: protectedReason || "",
    interacted: interaction.found,
    interactionReason: interaction.reason,
    tournamentStatus: tournament.status,
    tournamentReason: tournament.reason,
    yuniteMatch: tournament.match,
    epicId: tournament.epicId || "",
    epicName: tournament.epicName || "",
    eligible: false,
    eligibilityReason: "",
    bucket: "unknown"
  };

  if (record.protected) {
    record.bucket = "protected";
    record.eligibilityReason = record.protectedReason;
    return record;
  }

  if (!member.kickable) {
    record.protected = true;
    record.protectedReason = "Bot cannot kick this member";
    record.bucket = "protected";
    record.eligibilityReason = record.protectedReason;
    return record;
  }

  if (ageDays == null || ageDays < minAgeDays) {
    record.bucket = "too_new";
    record.eligibilityReason =
      ageDays == null
        ? "Join date unavailable"
        : `Joined ${ageDays} day(s) ago (minimum ${minAgeDays})`;
    return record;
  }

  if (record.interacted) {
    record.bucket = "interacted";
    record.eligibilityReason = record.interactionReason;
    return record;
  }

  if (!activityComplete) {
    record.bucket = "unknown";
    record.eligibilityReason =
      "Stored activity sources could not be fully loaded";
    return record;
  }

  if (record.tournamentStatus === "played") {
    record.bucket = "played";
    record.eligibilityReason = record.tournamentReason;
    return record;
  }

  if (record.tournamentStatus !== "never_played") {
    record.bucket = "unknown";
    record.eligibilityReason = record.tournamentReason;
    return record;
  }

  record.eligible = true;
  record.bucket = "eligible";
  record.eligibilityReason =
    `Joined ${ageDays} days ago, no stored interaction, never played a ZBD event`;
  return record;
}

async function scanGuildMembers(guild, options = {}) {
  const minAgeDays = Math.max(1, Number(options.minAgeDays || 30));
  const invokerId = options.invokerId || "";
  const now = Date.now();
  const protectedRoleIds = defaultProtectedRoleIds();

  await guild.members.fetch();

  const members = [...guild.members.cache.values()];
  const discordIds = members
    .filter(member => !member.user?.bot)
    .map(member => member.id);

  const [activity, snapshot] = await Promise.all([
    loadStoredActivityUserIds(),
    loadYuniteSnapshot(discordIds)
  ]);

  const records = [];

  for (const member of members) {
    records.push(
      await classifyMember(member, {
        now,
        minAgeDays,
        activityIds: activity.ids,
        activityComplete: activity.complete,
        snapshot,
        invokerId,
        protectedRoleIds
      })
    );
  }

  records.sort((a, b) => {
    const aJoined = a.joinedTimestamp || 0;
    const bJoined = b.joinedTimestamp || 0;
    return aJoined - bJoined;
  });

  const counts = {
    checked: records.length,
    eligible: 0,
    played: 0,
    interacted: 0,
    tooNew: 0,
    unknown: 0,
    protected: 0
  };

  for (const record of records) {
    if (record.bucket === "eligible") counts.eligible++;
    else if (record.bucket === "played") counts.played++;
    else if (record.bucket === "interacted") counts.interacted++;
    else if (record.bucket === "too_new") counts.tooNew++;
    else if (record.bucket === "protected") counts.protected++;
    else counts.unknown++;
  }

  return {
    minAgeDays,
    counts,
    records,
    eligible: records.filter(record => record.eligible),
    unknown: records.filter(record => record.bucket === "unknown"),
    activityComplete: activity.complete,
    yunite: {
      loaded: snapshot.loaded,
      reason: snapshot.reason,
      tournamentCount: snapshot.tournamentCount,
      leaderboardFailures: snapshot.leaderboardFailures,
      linkBatchFailures: snapshot.linkBatchFailures,
      apiConfigured: Boolean(getYuniteApiKey())
    }
  };
}

async function inspectMember(guild, member, options = {}) {
  const minAgeDays = Math.max(1, Number(options.minAgeDays || 30));
  const invokerId = options.invokerId || "";
  const now = Date.now();
  const protectedRoleIds = defaultProtectedRoleIds();

  const [activity, snapshot] = await Promise.all([
    loadStoredActivityUserIds(),
    loadYuniteSnapshot([member.id])
  ]);

  const record = await classifyMember(member, {
    now,
    minAgeDays,
    activityIds: activity.ids,
    activityComplete: activity.complete,
    snapshot,
    invokerId,
    protectedRoleIds
  });

  return {
    record,
    activityComplete: activity.complete,
    yunite: {
      loaded: snapshot.loaded,
      reason: snapshot.reason,
      tournamentCount: snapshot.tournamentCount,
      apiConfigured: Boolean(getYuniteApiKey())
    }
  };
}

function formatJoinedDate(timestamp) {
  if (!timestamp) {
    return "Unknown";
  }

  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function tournamentStatusLabel(status) {
  if (status === "played") {
    return "Played";
  }

  if (status === "never_played") {
    return "Never played";
  }

  return "Unknown";
}

function yuniteMatchLabel(match) {
  if (match === "confirmed") {
    return "Confirmed";
  }

  if (match === "unmatched") {
    return "Not matched";
  }

  return "Unavailable";
}

function toCsvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildCsv(records, extraColumns = []) {
  const header = [
    "discord_id",
    "username",
    "joined_at",
    "server_age_days",
    "eligible",
    "reason",
    "tournament_status",
    "yunite_match",
    "epic_id",
    "interaction_found",
    "protected",
    ...extraColumns
  ];

  const rows = records.map(record =>
    [
      record.id,
      record.username,
      record.joinedTimestamp
        ? new Date(record.joinedTimestamp).toISOString()
        : "",
      record.ageDays ?? "",
      record.eligible ? "yes" : "no",
      record.eligibilityReason,
      record.tournamentStatus,
      record.yuniteMatch,
      record.epicId,
      record.interacted ? "yes" : "no",
      record.protected ? "yes" : "no"
    ]
      .map(toCsvCell)
      .join(",")
  );

  return [header.join(","), ...rows].join("\n");
}

function userCanPrune(member) {
  return userIsStaff(member);
}

function userCanKickPrune(member) {
  return (
    userCanPrune(member) &&
    Boolean(member?.permissions?.has(PermissionFlagsBits.KickMembers))
  );
}

module.exports = {
  LOG_CHANNEL_ID,
  AUDIT_RANGE,
  scanGuildMembers,
  inspectMember,
  formatJoinedDate,
  tournamentStatusLabel,
  yuniteMatchLabel,
  buildCsv,
  userCanPrune,
  userCanKickPrune,
  getProtectedReason,
  defaultProtectedRoleIds
};
