const axios = require("axios");
const { getApiBaseUrl, getDiscordApiHeaders } = require("./discordApi");
const { GIRL_ROLE_ID, memberHasGirlRole } = require("./memberProfile");
const { isGirlVerifiedOnSheet } = require("./girlRoleSheet");

const FEMALE_PENDING_ROLE_ID =
  process.env.FEMALE_PENDING_ROLE_ID || "1512035519591092294";

const FEMALE_GENDER_VALUE = Number(
  process.env.FEMALE_EVALUATED_GENDER_VALUE || 50
);

const MEMBER_LOOKUP_PATH =
  process.env.DISCORD_MEMBER_LOOKUP_PATH || "/api/member";

const ROLE_DELAY_MS = Number(process.env.FEMALE_PENDING_ROLE_DELAY_MS || 900);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function isJoinAutoApplyEnabled() {
  const raw = String(process.env.FEMALE_PENDING_ROLE_ON_JOIN ?? "true")
    .trim()
    .toLowerCase();

  return raw !== "false" && raw !== "0" && raw !== "no";
}

async function fetchEvaluationGender(discordId) {
  const url =
    `${getApiBaseUrl()}${MEMBER_LOOKUP_PATH}` +
    `?discordId=${encodeURIComponent(discordId)}`;

  const res = await axios.get(url, {
    headers: getDiscordApiHeaders(),
    timeout: 15_000,
    validateStatus: status => status < 500
  });

  if (res.status === 404) {
    return null;
  }

  if (res.status !== 200) {
    throw new Error(
      `member lookup failed (${res.status}): ${JSON.stringify(res.data)}`
    );
  }

  const gender =
    res.data?.evaluation?.Gender ??
    res.data?.evaluation?.gender ??
    res.data?.evaluationGender;

  return typeof gender === "number" ? gender : null;
}

function canAssignPendingRole(member, pendingRole) {
  if (!pendingRole) {
    return { ok: false, reason: "role_missing" };
  }

  if (pendingRole.managed) {
    return { ok: false, reason: "role_managed" };
  }

  const botMember = member.guild.members.me;

  if (
    botMember &&
    pendingRole.position >= botMember.roles.highest.position
  ) {
    return { ok: false, reason: "hierarchy" };
  }

  return { ok: true };
}

/**
 * Apply pending female role for a single member (join flow or post-sync).
 */
async function tryApplyFemalePendingRole(member, { source = "unknown" } = {}) {
  if (!isJoinAutoApplyEnabled()) {
    return { applied: false, reason: "disabled" };
  }

  if (!member || member.user?.bot) {
    return { applied: false, reason: "bot_or_missing" };
  }

  if (memberHasGirlRole(member)) {
    return { applied: false, reason: "already_verified" };
  }

  if (await isGirlVerifiedOnSheet(member.id)) {
    return { applied: false, reason: "girl_verified_on_sheet" };
  }

  if (member.roles.cache.has(FEMALE_PENDING_ROLE_ID)) {
    return { applied: false, reason: "already_pending" };
  }

  let gender;

  try {
    gender = await fetchEvaluationGender(member.id);
  } catch (err) {
    console.error(
      "[FEMALE PENDING ROLE] lookup failed:",
      member.user.tag,
      err?.message || err
    );
    return { applied: false, reason: "lookup_error" };
  }

  if (gender === null) {
    return { applied: false, reason: "not_on_site" };
  }

  if (gender !== FEMALE_GENDER_VALUE) {
    return { applied: false, reason: "not_female_evaluated" };
  }

  const pendingRole = member.guild.roles.cache.get(FEMALE_PENDING_ROLE_ID);
  const assignCheck = canAssignPendingRole(member, pendingRole);

  if (!assignCheck.ok) {
    console.warn(
      `[FEMALE PENDING ROLE] skip ${member.user.tag} (${source}): ${assignCheck.reason}`
    );
    return { applied: false, reason: assignCheck.reason };
  }

  try {
    await member.roles.add(pendingRole);
    console.log(
      `[FEMALE PENDING ROLE] applied on ${source}: ${member.user.tag}`
    );
    return { applied: true };
  } catch (err) {
    console.error(
      `[FEMALE PENDING ROLE] add failed (${source}):`,
      member.user.tag,
      err?.message || err
    );
    return { applied: false, reason: "discord_error" };
  }
}

/**
 * Remove pending role when Girl verified role is granted.
 */
async function handleFemalePendingOnMemberUpdate(oldMember, newMember) {
  if (!newMember || newMember.user?.bot) {
    return;
  }

  const hadVerified = oldMember?.roles?.cache?.has(GIRL_ROLE_ID);
  const hasVerified = newMember.roles.cache.has(GIRL_ROLE_ID);

  if (hadVerified || !hasVerified) {
    return;
  }

  if (!newMember.roles.cache.has(FEMALE_PENDING_ROLE_ID)) {
    return;
  }

  const pendingRole = newMember.guild.roles.cache.get(FEMALE_PENDING_ROLE_ID);

  try {
    await newMember.roles.remove(pendingRole);
    console.log(
      `[FEMALE PENDING ROLE] removed after verify: ${newMember.user.tag}`
    );
  } catch (err) {
    console.error(
      "[FEMALE PENDING ROLE] remove after verify failed:",
      newMember.user.tag,
      err?.message || err
    );
  }
}

/**
 * Backfill: apply pending role for website-listed female-evaluated members.
 */
async function applyFemalePendingRoleBackfill(guild, websiteMembers, { dryRun = false } = {}) {
  const pendingRole = guild.roles.cache.get(FEMALE_PENDING_ROLE_ID);

  if (!pendingRole) {
    throw new Error(
      `Pending female role not found in this server (${FEMALE_PENDING_ROLE_ID}).`
    );
  }

  const botMember = await guild.members.fetchMe();

  if (pendingRole.managed) {
    throw new Error("This role is managed and cannot be assigned.");
  }

  if (pendingRole.position >= botMember.roles.highest.position) {
    throw new Error("I cannot assign this role due to role hierarchy.");
  }

  await guild.members.fetch();

  let evaluatedOnSite = websiteMembers.length;
  let alreadyVerified = 0;
  let verifiedOnSheet = 0;
  let alreadyPending = 0;
  let notInGuild = 0;
  let applied = 0;
  let failed = 0;
  const appliedSamples = [];

  for (const entry of websiteMembers) {
    const discordUserId = entry?.discordUserId;

    if (!discordUserId) {
      continue;
    }

    const member = guild.members.cache.get(discordUserId);

    if (!member || member.user.bot) {
      notInGuild += 1;
      continue;
    }

    if (memberHasGirlRole(member)) {
      alreadyVerified += 1;
      continue;
    }

    if (await isGirlVerifiedOnSheet(discordUserId)) {
      verifiedOnSheet += 1;
      continue;
    }

    if (member.roles.cache.has(FEMALE_PENDING_ROLE_ID)) {
      alreadyPending += 1;
      continue;
    }

    if (dryRun) {
      applied += 1;

      if (appliedSamples.length < 15) {
        appliedSamples.push(member.user.tag);
      }

      continue;
    }

    try {
      await member.roles.add(pendingRole);
      applied += 1;

      if (appliedSamples.length < 15) {
        appliedSamples.push(member.user.tag);
      }
    } catch (err) {
      console.error(
        "[FEMALE PENDING ROLE] backfill add failed:",
        discordUserId,
        err?.message || err
      );
      failed += 1;
    }

    await delay(ROLE_DELAY_MS);
  }

  return {
    evaluatedOnSite,
    alreadyVerified,
    verifiedOnSheet,
    alreadyPending,
    notInGuild,
    applied,
    failed,
    appliedSamples
  };
}

module.exports = {
  FEMALE_PENDING_ROLE_ID,
  FEMALE_GENDER_VALUE,
  isJoinAutoApplyEnabled,
  tryApplyFemalePendingRole,
  handleFemalePendingOnMemberUpdate,
  applyFemalePendingRoleBackfill
};
