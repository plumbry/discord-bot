const TIER_RESTRICTIONS_URL =
  "https://coedzbd.com/tier-restrictions";

const TIER_ROLE_IDS = {
  S: "1387131245590351983",
  A: "1371652170428055642",
  B: "1371652213130133624",
  C: "1371652236093948025"
};

const TIER_ROLE_INDEX = {
  S: [TIER_ROLE_IDS.S],
  A: [TIER_ROLE_IDS.A],
  B: [TIER_ROLE_IDS.B],
  C: [TIER_ROLE_IDS.C]
};

const TIER_ORDER = { S: 0, A: 1, B: 2, C: 3 };

/** @type {Record<number, string[]>} */
const RAW_COMBOS = {
  2: ["S+C", "A+B", "A+C", "B+B", "B+C", "C+C"],
  3: [
    "S+B+C",
    "S+C+C",
    "A+A+C",
    "A+B+B",
    "A+B+C",
    "A+C+C",
    "B+B+B",
    "B+B+C",
    "B+C+C",
    "C+C+C"
  ],
  4: [
    "S+B+C+C",
    "S+C+C+C",
    "A+A+C+C",
    "A+B+B+C",
    "A+B+C+C",
    "A+C+C+C",
    "B+B+B+B",
    "B+B+B+C",
    "B+B+C+C",
    "B+C+C+C",
    "C+C+C+C"
  ]
};

function normalizeComboKey(combo) {

  return combo
    .split("+")
    .map(part => part.trim().toUpperCase())
    .sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b])
    .join("+");

}

/** @type {Record<number, Set<string>>} */
const ALLOWED_COMBOS = Object.fromEntries(
  Object.entries(RAW_COMBOS).map(([size, combos]) => [
    Number(size),
    new Set(combos.map(normalizeComboKey))
  ])
);

function buildTierRoleIndex() {

  return TIER_ROLE_INDEX;

}

/**
 * @param {import("discord.js").GuildMember} member
 * @param {Record<string, string[]>} tierRoleIndex
 */
function getMemberTier(member, tierRoleIndex) {

  const matches = [];

  for (const [letter, roleIds] of Object.entries(tierRoleIndex)) {

    if (roleIds.some(id => member.roles.cache.has(id))) {
      matches.push(letter);
    }

  }

  if (matches.length === 0) {
    return { ok: false, reason: "missing" };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      tiers: matches
    };
  }

  return { ok: true, tier: matches[0] };

}

function comboKeyFromTiers(tiers) {

  return [...tiers]
    .sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b])
    .join("+");

}

function isValidTierCombo(tiers, teamSize) {

  const allowed = ALLOWED_COMBOS[teamSize];

  if (!allowed) {
    return false;
  }

  return allowed.has(comboKeyFromTiers(tiers));

}

function formatTierCombo(tiers) {

  return comboKeyFromTiers(tiers)
    .split("+")
    .join("+");

}

function formatInvalidTierSignupMessage({
  users,
  tiers,
  teamSize,
  reason,
  ambiguousUser
}) {

  const mentions = users.map(u => `<@${u.id}>`).join(" ");

  if (reason === "missing_tier") {
    return (
      `Rejected signup (missing tier role): ${mentions}\n` +
      "Each player needs exactly one tier role (S tier / A tier / B tier / C tier).\n" +
      `Allowed combos: ${TIER_RESTRICTIONS_URL}`
    );
  }

  if (reason === "ambiguous_tier" && ambiguousUser) {
    return (
      `Rejected signup (multiple tier roles on <@${ambiguousUser.id}>): ${mentions}\n` +
      `Allowed combos: ${TIER_RESTRICTIONS_URL}`
    );
  }

  const combo = tiers?.length
    ? formatTierCombo(tiers)
    : "unknown";

  const modeLabel =
    teamSize === 2
      ? "duo"
      : teamSize === 3
        ? "trio"
        : "squad";

  return (
    `Rejected signup (invalid ${modeLabel} tier combo **${combo}**): ${mentions}\n` +
    `See allowed combinations: ${TIER_RESTRICTIONS_URL}`
  );

}

/**
 * Resolve each player's tier and whether the team combo is legal.
 *
 * @param {import("discord.js").Guild} guild
 * @param {import("discord.js").User[]} users
 * @param {number} teamSize
 */
async function validateTeamTierCombo(guild, users, teamSize) {

  const tierRoleIndex = buildTierRoleIndex();
  const tiers = [];

  for (const user of users) {

    let member = guild.members.cache.get(user.id);

    if (!member) {
      member = await guild.members.fetch(user.id).catch(() => null);
    }

    if (!member) {
      return {
        ok: false,
        reason: "missing_tier",
        tiers: []
      };
    }

    const tierResult = getMemberTier(member, tierRoleIndex);

    if (!tierResult.ok) {

      if (tierResult.reason === "ambiguous") {
        return {
          ok: false,
          reason: "ambiguous_tier",
          tiers: [],
          ambiguousUser: user
        };
      }

      return {
        ok: false,
        reason: "missing_tier",
        tiers: []
      };

    }

    tiers.push(tierResult.tier);

  }

  if (!isValidTierCombo(tiers, teamSize)) {
    return {
      ok: false,
      reason: "invalid_combo",
      tiers
    };
  }

  return {
    ok: true,
    tiers,
    combo: formatTierCombo(tiers)
  };

}

module.exports = {
  TIER_RESTRICTIONS_URL,
  TIER_ROLE_IDS,
  ALLOWED_COMBOS,
  buildTierRoleIndex,
  getMemberTier,
  isValidTierCombo,
  formatTierCombo,
  formatInvalidTierSignupMessage,
  validateTeamTierCombo
};
