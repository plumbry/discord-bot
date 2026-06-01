const { AuditLogEvent } = require("discord.js");
const { deleteTierRoles } = require("./tierClear");

const DEFAULT_GUARDIAN_IDS = [
  "1097284777805086721", // Head Admin
  "504761348983357451", // Admin
  "684933831874183168" // Admin
];

function parseGuardianIds() {
  const raw = process.env.TIER_GUARDIAN_USER_IDS;

  if (!raw || !raw.trim()) {
    return new Set(DEFAULT_GUARDIAN_IDS);
  }

  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return new Set(ids.length > 0 ? ids : DEFAULT_GUARDIAN_IDS);
}

const GUARDIAN_IDS = parseGuardianIds();

const REQUIRE_AUDIT = process.env.TIER_WIPE_REQUIRE_AUDIT
  ? process.env.TIER_WIPE_REQUIRE_AUDIT.toLowerCase() !== "false"
  : true;

const WIPE_COOLDOWN_MS = Number(process.env.TIER_WIPE_COOLDOWN_MS || 60_000);

// How recent an audit-log entry must be to count as "this removal".
const AUDIT_MATCH_WINDOW_MS = Number(process.env.TIER_WIPE_AUDIT_WINDOW_MS || 15_000);

// Audit-log entries can lag a beat behind the gateway event.
const AUDIT_RETRIES = Number(process.env.TIER_WIPE_AUDIT_RETRIES || 3);
const AUDIT_RETRY_DELAY_MS = Number(process.env.TIER_WIPE_AUDIT_RETRY_DELAY_MS || 1_000);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let wipeInFlight = false;
let lastWipeAt = 0;

function isGuardian(userId) {
  return GUARDIAN_IDS.has(String(userId));
}

/**
 * Determine whether a guardian's removal was a kick/ban (vs a voluntary leave)
 * by inspecting the guild audit log. Retries briefly to absorb audit-log lag.
 *
 * @param {import("discord.js").Guild} guild
 * @param {string} userId
 * @returns {Promise<"kick"|"ban"|null>} reason, or null if it looks like a voluntary leave
 */
async function confirmKickOrBan(guild, userId) {
  const checks = [
    { type: AuditLogEvent.MemberBanAdd, reason: "ban" },
    { type: AuditLogEvent.MemberKick, reason: "kick" }
  ];

  for (let attempt = 0; attempt < AUDIT_RETRIES; attempt++) {
    for (const { type, reason } of checks) {
      let logs;

      try {
        logs = await guild.fetchAuditLogs({ type, limit: 5 });
      } catch (err) {
        // No View Audit Log permission (or transient failure).
        if (!REQUIRE_AUDIT) {
          console.warn(
            "[GUARDIAN WIPE] audit log unreadable; REQUIRE_AUDIT=false, treating as removal:",
            err?.message || err
          );
          return "removal";
        }

        console.error(
          "[GUARDIAN WIPE] could not read audit log (need View Audit Log permission):",
          err?.message || err
        );
        return null;
      }

      const now = Date.now();
      const match = logs.entries.find(
        (entry) =>
          entry.target?.id === userId &&
          now - entry.createdTimestamp <= AUDIT_MATCH_WINDOW_MS
      );

      if (match) {
        return reason;
      }
    }

    if (attempt < AUDIT_RETRIES - 1) {
      await delay(AUDIT_RETRY_DELAY_MS);
    }
  }

  return null;
}

/**
 * Run the tier wipe (role deletion) once, guarded by a re-entrancy lock and
 * cooldown so several near-simultaneous guardian removals don't double-fire.
 *
 * @param {import("discord.js").Client} client
 * @param {string} guildId
 * @param {{ reason?: string, triggeredBy?: string }} [meta]
 */
async function runGuardianWipe(client, guildId, { reason = "removal", triggeredBy } = {}) {
  const now = Date.now();

  if (wipeInFlight) {
    console.log("[GUARDIAN WIPE] skipped - a wipe is already running");
    return null;
  }

  if (now - lastWipeAt < WIPE_COOLDOWN_MS) {
    console.log("[GUARDIAN WIPE] skipped - within cooldown window");
    return null;
  }

  wipeInFlight = true;

  try {
    const { results } = await deleteTierRoles(client, {
      guildId,
      reason: `Guardian ${reason}${triggeredBy ? ` (${triggeredBy})` : ""} - tier wipe`
    });

    lastWipeAt = Date.now();

    return results;
  } finally {
    wipeInFlight = false;
  }
}

/**
 * Best-effort notification to the kicked guardian that the wipe ran.
 *
 * @param {import("discord.js").Client} client
 * @param {string} userId
 * @param {string} text
 */
async function notifyGuardian(client, userId, text) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(text);
  } catch (err) {
    console.warn("[GUARDIAN WIPE] could not DM guardian:", err?.message || err);
  }
}

/**
 * Entry point wired to the guildMemberRemove event. Confirms the removal was a
 * kick/ban of a guardian, then deletes the tier roles.
 *
 * @param {import("discord.js").Client} client
 * @param {import("discord.js").GuildMember | import("discord.js").PartialGuildMember} member
 */
async function handleGuardianRemoval(client, member) {
  if (!member || !isGuardian(member.id)) {
    return;
  }

  const reason = await confirmKickOrBan(member.guild, member.id);

  if (!reason) {
    console.log(
      `[GUARDIAN WIPE] guardian ${member.id} left but not confirmed as kick/ban - ignoring`
    );
    return;
  }

  console.log(
    `[GUARDIAN WIPE] guardian ${member.id} ${reason} detected - deleting tier roles`
  );

  const results = await runGuardianWipe(client, member.guild.id, {
    reason,
    triggeredBy: member.id
  });

  if (results) {
    const summary = results
      .map((r) => `${r.name || r.roleId}: ${r.status}`)
      .join(", ");

    console.log(`[GUARDIAN WIPE] tier role deletion complete - ${summary}`);

    await notifyGuardian(
      client,
      member.id,
      `Detected a ${reason} of a guardian account in your server. ` +
        `The tier roles (S/A/B/C) were deleted as a safeguard.\nResult: ${summary}`
    );
  }
}

module.exports = {
  GUARDIAN_IDS,
  isGuardian,
  confirmKickOrBan,
  runGuardianWipe,
  handleGuardianRemoval
};
