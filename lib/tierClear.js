const { TIER_ROLE_IDS } = require("./tierRestrictions");

const ROLE_DELAY_MS = Number(process.env.TIER_CLEAR_DELAY_MS || 900);

const TIER_ROLE_ID_LIST = Object.values(TIER_ROLE_IDS);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveGuild(client, guildId) {
  const cached = client.guilds.cache.get(guildId);

  if (cached) {
    return cached;
  }

  return client.guilds.fetch(guildId);
}

/**
 * Remove every tier role (S/A/B/C) from all members who currently have one.
 *
 * @param {import("discord.js").Client} client
 * @param {object} options
 * @param {string} options.guildId
 * @param {boolean} [options.dryRun] When true, count affected members without removing anything.
 * @param {(progress: { total: number, processed: number, removed: number, failed: number }) => void} [options.onProgress]
 */
async function clearAllTierRoles(client, { guildId, dryRun = false, onProgress } = {}) {
  if (!guildId) {
    throw new Error("guildId is required");
  }

  const guild = await resolveGuild(client, guildId);

  if (!guild) {
    throw new Error(`Guild ${guildId} not found`);
  }

  const botMember = await guild.members.fetchMe();
  const botHighest = botMember.roles.highest.position;

  const blockedRoles = [];

  for (const roleId of TIER_ROLE_ID_LIST) {
    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));

    if (role && role.position >= botHighest) {
      blockedRoles.push(role.name || roleId);
    }
  }

  if (blockedRoles.length > 0) {
    throw new Error(
      "Bot role is not high enough to remove these tier roles: " + blockedRoles.join(", ")
    );
  }

  const allMembers = await guild.members.fetch();

  const targets = allMembers.filter(
    (member) => !member.user.bot && TIER_ROLE_ID_LIST.some((id) => member.roles.cache.has(id))
  );

  const total = targets.size;

  let processed = 0;
  let removed = 0;
  let failed = 0;

  const report = () => {
    if (typeof onProgress === "function") {
      onProgress({ total, processed, removed, failed });
    }
  };

  report();

  for (const member of targets.values()) {
    const rolesToRemove = TIER_ROLE_ID_LIST.filter((id) => member.roles.cache.has(id));

    if (rolesToRemove.length === 0) {
      processed++;
      continue;
    }

    if (dryRun) {
      removed++;
      processed++;
      report();
      continue;
    }

    try {
      await member.roles.remove(rolesToRemove, "Tier clear");
      removed++;
    } catch {
      failed++;
    }

    processed++;
    report();

    await delay(ROLE_DELAY_MS);
  }

  return {
    guildId,
    dryRun,
    total,
    processed,
    removed,
    failed,
    tierRoleIds: TIER_ROLE_ID_LIST
  };
}

/**
 * Delete the tier roles (S/A/B/C) outright. Deleting a role removes it from
 * every member server-side in a single API call, so this is fast enough to run
 * before the bot itself can be kicked (unlike per-member removal).
 *
 * @param {import("discord.js").Client} client
 * @param {object} options
 * @param {string} options.guildId
 * @param {string} [options.reason] Audit-log reason recorded on each deletion.
 * @returns {Promise<{ guildId: string, results: Array<{ roleId: string, name: string|null, status: "deleted"|"missing"|"blocked"|"failed", error?: string }> }>}
 */
async function deleteTierRoles(client, { guildId, reason = "Guardian kicked - tier wipe" } = {}) {
  if (!guildId) {
    throw new Error("guildId is required");
  }

  const guild = await resolveGuild(client, guildId);

  if (!guild) {
    throw new Error(`Guild ${guildId} not found`);
  }

  const botMember = await guild.members.fetchMe();
  const botHighest = botMember.roles.highest.position;

  const results = [];

  for (const roleId of TIER_ROLE_ID_LIST) {
    const role =
      guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));

    if (!role) {
      results.push({ roleId, name: null, status: "missing" });
      continue;
    }

    if (role.position >= botHighest) {
      results.push({ roleId, name: role.name || null, status: "blocked" });
      continue;
    }

    try {
      await role.delete(reason);
      results.push({ roleId, name: role.name || null, status: "deleted" });
    } catch (err) {
      results.push({
        roleId,
        name: role.name || null,
        status: "failed",
        error: err?.message || String(err)
      });
    }
  }

  return { guildId, results };
}

module.exports = {
  clearAllTierRoles,
  deleteTierRoles,
  TIER_ROLE_ID_LIST
};
