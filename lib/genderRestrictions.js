const { GIRL_ROLE_ID, BOY_ROLE_ID } = require("./memberProfile");

const FORMAT_BY_TEAM_SIZE = {
  2: "duos",
  3: "trios",
  4: "squads"
};

const TEAM_SIZE_BY_FORMAT = {
  duos: 2,
  trios: 3,
  squads: 4
};

const FORMAT_LABELS = {
  duos: "Duos",
  trios: "Trios",
  squads: "Squads"
};

function formatFromTeamSize(teamSize) {
  return FORMAT_BY_TEAM_SIZE[teamSize] || null;
}

function teamSizeFromFormat(format) {
  return TEAM_SIZE_BY_FORMAT[format] || null;
}

function formatLabel(format) {
  return FORMAT_LABELS[format] || format;
}

function isValidGenderCombination(format, girlCount, boyCount) {
  switch (format) {
    case "duos":
      return girlCount === 1 && boyCount === 1;

    case "trios":
      return (
        (girlCount === 1 && boyCount === 2) ||
        (girlCount === 2 && boyCount === 1)
      );

    case "squads":
      return girlCount === 2 && boyCount === 2;

    default:
      return false;
  }
}

/**
 * True when a (possibly partial) gender mix can still become a legal
 * final team for the format, including when it is already complete.
 */
function canReachValidGenderCombination(
  format,
  girlCount,
  boyCount,
  teamSize
) {
  const size = teamSize || teamSizeFromFormat(format);

  if (!size) {
    return false;
  }

  const currentSize = girlCount + boyCount;

  if (currentSize > size) {
    return false;
  }

  const remaining = size - currentSize;

  for (let addGirls = 0; addGirls <= remaining; addGirls++) {
    const addBoys = remaining - addGirls;

    if (
      isValidGenderCombination(
        format,
        girlCount + addGirls,
        boyCount + addBoys
      )
    ) {
      return true;
    }
  }

  return false;
}

function describeValidGenderCompositions(format) {
  switch (format) {
    case "duos":
      return "1 Woman + 1 Boy";
    case "trios":
      return "1 Woman + 2 Boys, or 2 Women + 1 Boy";
    case "squads":
      return "2 Women + 2 Boys";
    default:
      return "a valid co-ed team";
  }
}

function classifyMemberGender(member) {
  if (!member) {
    return null;
  }

  const hasGirl = member.roles.cache.has(GIRL_ROLE_ID);
  const hasBoy = member.roles.cache.has(BOY_ROLE_ID);

  if (hasGirl && hasBoy) {
    return "both";
  }

  if (hasGirl) {
    return "girl";
  }

  if (hasBoy) {
    return "boy";
  }

  return null;
}

async function resolveGuildMember(guild, userId) {
  let member = guild.members.cache.get(userId);

  if (!member) {
    member = await guild.members.fetch(userId).catch(() => null);
  }

  return member;
}

function formatInvalidGenderSignupMessage({
  reason,
  format,
  users,
  girlCount,
  boyCount,
  missingRoleUsers,
  bothRoleUsers,
  unresolvedUsers
}) {
  if (reason === "player_roles") {
    const lines = ["❌ Cannot validate this team.", ""];
    const unresolved = unresolvedUsers || [];
    const missing = missingRoleUsers || [];
    const both = bothRoleUsers || [];

    for (const user of unresolved) {
      lines.push(
        `<@${user.id}> could not be found in this server.`
      );
    }

    for (const user of missing) {
      lines.push(
        `<@${user.id}> does not have a recognised gender role.`
      );
    }

    for (const user of both) {
      lines.push(
        `<@${user.id}> has both gender roles assigned. Please correct their roles first.`
      );
    }

    if (unresolved.length > 0 || missing.length > 0) {
      lines.push(
        "",
        "Required roles:",
        `Girl — ${GIRL_ROLE_ID}`,
        `Boy — ${BOY_ROLE_ID}`
      );
    }

    return lines.join("\n");
  }

  const mentions = users.map(user => `<@${user.id}>`).join(" ");
  const currentTeam =
    "Current team:\n" +
    `👩 Girls: ${girlCount}\n` +
    `👨 Boys: ${boyCount}`;

  if (format === "duos") {
    return (
      "❌ Invalid duo combination.\n\n" +
      `${mentions}\n\n` +
      `${currentTeam}\n\n` +
      "Duos must contain:\n" +
      "1 girl + 1 boy"
    );
  }

  if (format === "trios") {
    return (
      "❌ Invalid trio combination.\n\n" +
      `${mentions}\n\n` +
      `${currentTeam}\n\n` +
      "Trios must be:\n" +
      "• 1 girl + 2 boys\n" +
      "or\n" +
      "• 2 girls + 1 boy"
    );
  }

  return (
    "❌ Invalid squad combination.\n\n" +
    `${mentions}\n\n` +
    `${currentTeam}\n\n` +
    "Squads must contain exactly:\n" +
    "2 girls + 2 boys"
  );
}

/**
 * Resolve each tagged player's Discord gender role and whether the
 * team combination is legal for duos / trios / squads.
 *
 * Gender is taken only from GIRL_ROLE_ID / BOY_ROLE_ID. Usernames,
 * nicknames, Fortnite accounts, and tier roles are ignored.
 *
 * @param {import("discord.js").Guild} guild
 * @param {import("discord.js").User[]} users
 * @param {number} teamSize
 */
async function validateTeamGenderCombo(guild, users, teamSize) {
  const format = formatFromTeamSize(teamSize);

  if (!format) {
    return { ok: true };
  }

  const players = [];
  const missingRoleUsers = [];
  const bothRoleUsers = [];
  const unresolvedUsers = [];

  for (const user of users) {
    const member = await resolveGuildMember(guild, user.id);

    if (!member) {
      unresolvedUsers.push(user);
      players.push({ user, member: null });
      continue;
    }

    const gender = classifyMemberGender(member);

    if (gender === "both") {
      bothRoleUsers.push(user);
    } else if (!gender) {
      missingRoleUsers.push(user);
    }

    players.push({ user, member, gender });
  }

  if (
    unresolvedUsers.length > 0 ||
    missingRoleUsers.length > 0 ||
    bothRoleUsers.length > 0
  ) {
    return {
      ok: false,
      reason: "player_roles",
      format,
      users,
      missingRoleUsers,
      bothRoleUsers,
      unresolvedUsers
    };
  }

  const girlCount = players.filter(player =>
    player.member.roles.cache.has(GIRL_ROLE_ID)
  ).length;

  const boyCount = players.filter(player =>
    player.member.roles.cache.has(BOY_ROLE_ID)
  ).length;

  if (!isValidGenderCombination(format, girlCount, boyCount)) {
    return {
      ok: false,
      reason: "invalid_combo",
      format,
      users,
      girlCount,
      boyCount
    };
  }

  return {
    ok: true,
    format,
    girlCount,
    boyCount
  };
}

module.exports = {
  GIRL_ROLE_ID,
  BOY_ROLE_ID,
  FORMAT_BY_TEAM_SIZE,
  TEAM_SIZE_BY_FORMAT,
  FORMAT_LABELS,
  formatFromTeamSize,
  teamSizeFromFormat,
  formatLabel,
  isValidGenderCombination,
  canReachValidGenderCombination,
  describeValidGenderCompositions,
  classifyMemberGender,
  formatInvalidGenderSignupMessage,
  validateTeamGenderCombo
};
