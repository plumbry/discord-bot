const {
  classifyMemberGender,
  isValidGenderCombination,
  canReachValidGenderCombination,
  describeValidGenderCompositions,
  formatLabel
} = require("./genderRestrictions");

const {
  buildTierRoleIndex,
  getMemberTier,
  isValidTierCombo,
  canReachValidTierCombo,
  formatTierCombo
} = require("./tierRestrictions");

const GENDER_LABEL = {
  girl: "Woman",
  boy: "Boy"
};

function mention(userId) {
  return `<@${userId}>`;
}

async function resolveGuildMember(guild, userId) {
  let member = guild.members.cache.get(userId);

  if (!member) {
    member = await guild.members.fetch(userId).catch(() => null);
  }

  return member;
}

/**
 * Read gender + tier from Discord roles at match time.
 * Does not parse notes or usernames.
 */
async function readPlayerProfile(guild, userId) {
  const member = await resolveGuildMember(guild, userId);

  if (!member) {
    return {
      ok: false,
      userId,
      reason: "not_in_guild"
    };
  }

  const gender = classifyMemberGender(member);
  const tierResult = getMemberTier(member, buildTierRoleIndex());

  if (gender === "both") {
    return {
      ok: false,
      userId,
      member,
      reason: "ambiguous_gender"
    };
  }

  if (!gender) {
    return {
      ok: false,
      userId,
      member,
      reason: "missing_gender"
    };
  }

  if (!tierResult.ok) {
    return {
      ok: false,
      userId,
      member,
      gender,
      reason:
        tierResult.reason === "ambiguous" ? "ambiguous_tier" : "missing_tier",
      tiers: tierResult.tiers
    };
  }

  return {
    ok: true,
    userId,
    member,
    gender,
    genderLabel: GENDER_LABEL[gender],
    tier: tierResult.tier
  };
}

async function readPlayerProfiles(guild, userIds) {
  const profiles = [];

  for (const userId of userIds) {
    profiles.push(await readPlayerProfile(guild, userId));
  }

  return profiles;
}

function uniqueUserIds(userIds) {
  return [...new Set(userIds)];
}

function summarizeProfiles(profiles) {
  const okProfiles = profiles.filter(profile => profile.ok);

  return {
    girlCount: okProfiles.filter(profile => profile.gender === "girl").length,
    boyCount: okProfiles.filter(profile => profile.gender === "boy").length,
    tiers: okProfiles.map(profile => profile.tier)
  };
}

function formatProfileIssue(profile) {
  const who = mention(profile.userId);

  switch (profile.reason) {
    case "not_in_guild":
      return `${who} is not in this server.`;
    case "missing_gender":
      return `${who} needs exactly one gender role (Woman or Boy).`;
    case "ambiguous_gender":
      return `${who} has both Woman and Boy roles. A mod needs to correct this.`;
    case "missing_tier":
      return `${who} needs exactly one tier role (S, A, B, or C).`;
    case "ambiguous_tier":
      return `${who} has more than one tier role. A mod needs to correct this.`;
    default:
      return `${who} could not be validated.`;
  }
}

function describeCurrentComposition(profiles) {
  const { girlCount, boyCount, tiers } = summarizeProfiles(
    profiles.filter(profile => profile.ok)
  );
  const genderBits = [];

  if (girlCount) {
    genderBits.push(`${girlCount} ${girlCount === 1 ? "Woman" : "Women"}`);
  }

  if (boyCount) {
    genderBits.push(`${boyCount} ${boyCount === 1 ? "Boy" : "Boys"}`);
  }

  const genderText = genderBits.join(" + ") || "no recognised gender roles";
  const tierText = tiers.length ? formatTierCombo(tiers) : "unknown";

  return `${genderText} (${tierText})`;
}

function validateGroup(
  profiles,
  { format, teamSize, tierRuleId, requireComplete = false }
) {
  const ids = profiles.map(profile => profile.userId);

  if (uniqueUserIds(ids).length !== ids.length) {
    return {
      ok: false,
      reason: "duplicate_users",
      message: "The same Discord user cannot appear twice on a team."
    };
  }

  const failed = profiles.filter(profile => !profile.ok);

  if (failed.length > 0) {
    return {
      ok: false,
      reason: "player_roles",
      message: failed.map(formatProfileIssue).join("\n")
    };
  }

  const size = profiles.length;

  if (size > teamSize) {
    return {
      ok: false,
      reason: "oversize",
      message:
        `This group has ${size} players, but ${formatLabel(format)} teams are ${teamSize}.`
    };
  }

  const { girlCount, boyCount, tiers } = summarizeProfiles(profiles);
  const complete = size === teamSize;

  if (requireComplete && !complete) {
    return {
      ok: false,
      reason: "incomplete",
      message: `This group has ${size} players; ${formatLabel(format)} needs ${teamSize}.`
    };
  }

  if (complete) {
    if (!isValidGenderCombination(format, girlCount, boyCount)) {
      return {
        ok: false,
        reason: "invalid_gender",
        girlCount,
        boyCount,
        message:
          `This ${formatLabel(format)} gender mix is not allowed.\n` +
          `Current: ${describeCurrentComposition(profiles)}\n` +
          `Required: ${describeValidGenderCompositions(format)}`
      };
    }

    if (!isValidTierCombo(tiers, teamSize, tierRuleId)) {
      return {
        ok: false,
        reason: "invalid_tier",
        tiers,
        message:
          `This ${formatLabel(format)} tier combo **${formatTierCombo(tiers)}** is not allowed.`
      };
    }

    return {
      ok: true,
      complete: true,
      girlCount,
      boyCount,
      tiers
    };
  }

  if (!canReachValidGenderCombination(format, girlCount, boyCount, teamSize)) {
    return {
      ok: false,
      reason: "impossible_gender",
      girlCount,
      boyCount,
      message:
        `This group cannot become a valid ${formatLabel(format)} team.\n` +
        `Current: ${describeCurrentComposition(profiles)}\n` +
        `${formatLabel(format)} must be: ${describeValidGenderCompositions(format)}`
    };
  }

  if (!canReachValidTierCombo(tiers, teamSize, tierRuleId)) {
    return {
      ok: false,
      reason: "impossible_tier",
      tiers,
      message:
        `This group's tiers (${formatTierCombo(tiers)}) cannot reach a legal ` +
        `${formatLabel(format)} combination.`
    };
  }

  return {
    ok: true,
    complete: false,
    girlCount,
    boyCount,
    tiers
  };
}

async function validateRequestMembers(
  guild,
  memberUserIds,
  eventConfig
) {
  const uniqueIds = uniqueUserIds(memberUserIds);

  if (uniqueIds.length !== memberUserIds.length) {
    return {
      ok: false,
      message: "The same Discord user cannot appear twice on a team."
    };
  }

  if (uniqueIds.length >= eventConfig.teamSize) {
    return {
      ok: false,
      message:
        `That would already be a full ${formatLabel(eventConfig.format)} team ` +
        `(${eventConfig.teamSize} players). LFG is only for filling incomplete teams.`
    };
  }

  const profiles = await readPlayerProfiles(guild, uniqueIds);
  const result = validateGroup(profiles, {
    format: eventConfig.format,
    teamSize: eventConfig.teamSize,
    tierRuleId: eventConfig.tierRuleId,
    requireComplete: false
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    profiles,
    ...result
  };
}

module.exports = {
  GENDER_LABEL,
  mention,
  readPlayerProfile,
  readPlayerProfiles,
  summarizeProfiles,
  formatProfileIssue,
  describeCurrentComposition,
  validateGroup,
  validateRequestMembers
};
