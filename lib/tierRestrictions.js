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
const TIER_LETTERS = ["S", "A", "B", "C"];

const DEFAULT_TIER_RULESET_ID = "standard";

/**
 * Named tier-restriction rulesets. `/roletagged` and `/lfg` both read
 * from this table so combo legality cannot drift between commands.
 *
 * @type {Record<string, {
 *   id: string,
 *   name: string,
 *   combosByTeamSize: Record<number, string[]>
 * }>}
 */
const TIER_RULESETS = {
  standard: {
    id: "standard",
    name: "Standard ZBD",
    combosByTeamSize: {
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
    }
  }
};

function normalizeComboKey(combo) {
  return combo
    .split("+")
    .map(part => part.trim().toUpperCase())
    .sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b])
    .join("+");
}

function buildAllowedComboSets(combosByTeamSize) {
  return Object.fromEntries(
    Object.entries(combosByTeamSize).map(([size, combos]) => [
      Number(size),
      new Set(combos.map(normalizeComboKey))
    ])
  );
}

/** @type {Map<string, Record<number, Set<string>>>} */
const allowedComboCache = new Map();

function getTierRuleset(rulesetId = DEFAULT_TIER_RULESET_ID) {
  return TIER_RULESETS[rulesetId] || null;
}

function listTierRulesets() {
  return Object.values(TIER_RULESETS).map(ruleset => ({
    id: ruleset.id,
    name: ruleset.name
  }));
}

function resolveRulesetId(rulesetId) {
  if (rulesetId && TIER_RULESETS[rulesetId]) {
    return rulesetId;
  }

  return DEFAULT_TIER_RULESET_ID;
}

function getAllowedCombos(teamSize, rulesetId = DEFAULT_TIER_RULESET_ID) {
  const id = resolveRulesetId(rulesetId);
  let bySize = allowedComboCache.get(id);

  if (!bySize) {
    bySize = buildAllowedComboSets(TIER_RULESETS[id].combosByTeamSize);
    allowedComboCache.set(id, bySize);
  }

  return bySize[teamSize] || null;
}

/** Standard ZBD allowed combos, kept for existing callers. */
const ALLOWED_COMBOS = buildAllowedComboSets(
  TIER_RULESETS.standard.combosByTeamSize
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

function countTiers(tiers) {
  const counts = { S: 0, A: 0, B: 0, C: 0 };

  for (const tier of tiers) {
    const letter = String(tier || "").trim().toUpperCase();

    if (counts[letter] !== undefined) {
      counts[letter] += 1;
    }
  }

  return counts;
}

function isValidTierCombo(
  tiers,
  teamSize,
  rulesetId = DEFAULT_TIER_RULESET_ID
) {
  const allowed = getAllowedCombos(teamSize, rulesetId);

  if (!allowed || tiers.length !== teamSize) {
    return false;
  }

  return allowed.has(comboKeyFromTiers(tiers));
}

/**
 * True when this (possibly partial) set of tiers can still become a
 * legal combo for the ruleset, including when it is already complete.
 */
function canReachValidTierCombo(
  tiers,
  teamSize,
  rulesetId = DEFAULT_TIER_RULESET_ID
) {
  if (!Array.isArray(tiers) || tiers.length > teamSize) {
    return false;
  }

  if (tiers.length === teamSize) {
    return isValidTierCombo(tiers, teamSize, rulesetId);
  }

  const allowed = getAllowedCombos(teamSize, rulesetId);

  if (!allowed) {
    return false;
  }

  const current = countTiers(tiers);

  for (const combo of allowed) {
    const allowedCounts = countTiers(combo.split("+"));
    const fits = TIER_LETTERS.every(
      letter => current[letter] <= allowedCounts[letter]
    );

    if (fits) {
      return true;
    }
  }

  return false;
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
 * @param {string} [rulesetId]
 */
async function validateTeamTierCombo(
  guild,
  users,
  teamSize,
  rulesetId = DEFAULT_TIER_RULESET_ID
) {
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

  if (!isValidTierCombo(tiers, teamSize, rulesetId)) {
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
  DEFAULT_TIER_RULESET_ID,
  TIER_RULESETS,
  buildTierRoleIndex,
  getMemberTier,
  getTierRuleset,
  listTierRulesets,
  resolveRulesetId,
  isValidTierCombo,
  canReachValidTierCombo,
  formatTierCombo,
  formatInvalidTierSignupMessage,
  validateTeamTierCombo
};
