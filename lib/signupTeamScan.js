const {
  getRows,
  getSignupBlockReason
} = require("../event-bans/eventBans");

const {
  formatInvalidTierSignupMessage,
  validateTeamTierCombo
} = require("../lib/tierRestrictions");

const MESSAGE_SCAN_LIMIT = 100;

const TEAM_LIMITS = {
  normal: {
    1: 100,
    2: 50,
    3: 33,
    4: 25
  },
  reload: {
    1: 40,
    2: 20,
    3: 13,
    4: 10
  }
};

function buildFlaggedTeamLookup(flaggedTeams) {
  const flaggedByMessageId = new Map();

  for (const entry of flaggedTeams) {
    flaggedByMessageId.set(entry.team.message.id, entry);
  }

  return flaggedByMessageId;
}

function resolveValidTeamsInSignupOrder(
  candidateTeams,
  eligibleMessageIds,
  flaggedByMessageId,
  includeBanned
) {
  const validTeams = [];
  const skippedBannedTeams = [];

  for (const team of candidateTeams) {
    const messageId = team.message.id;

    if (eligibleMessageIds.has(messageId)) {
      validTeams.push(team);
      continue;
    }

    const flagged = flaggedByMessageId.get(messageId);

    if (!flagged) {
      continue;
    }

    if (includeBanned) {
      validTeams.push(team);
    } else {
      skippedBannedTeams.push(flagged);
    }
  }

  return { validTeams, skippedBannedTeams };
}

function buildNumberedTeams(validTeams, {
  isReload,
  requiredTeamSize,
  twoLobbies
}) {
  const teamLimit =
    TEAM_LIMITS[isReload ? "reload" : "normal"][requiredTeamSize];
  const numberedTeams = [];

  if (twoLobbies) {
    const lobby1Teams = validTeams.slice(0, teamLimit);
    const lobby2Teams = validTeams.slice(teamLimit, teamLimit * 2);
    const overflowTeams = validTeams.slice(teamLimit * 2);

    for (let index = 0; index < lobby1Teams.length; index++) {
      numberedTeams.push({
        team: lobby1Teams[index],
        teamNumber: index + 1,
        asOverflow: false,
        lobby: 1
      });
    }

    for (let index = 0; index < lobby2Teams.length; index++) {
      numberedTeams.push({
        team: lobby2Teams[index],
        teamNumber: index + 1,
        asOverflow: false,
        lobby: 2
      });
    }

    for (let index = 0; index < overflowTeams.length; index++) {
      numberedTeams.push({
        team: overflowTeams[index],
        teamNumber: index + 1,
        asOverflow: true,
        lobby: null
      });
    }

    return numberedTeams;
  }

  const roledTeams = validTeams.slice(0, teamLimit);
  const overflowTeams = validTeams.slice(teamLimit);

  for (let index = 0; index < roledTeams.length; index++) {
    numberedTeams.push({
      team: roledTeams[index],
      teamNumber: index + 1,
      asOverflow: false,
      lobby: null
    });
  }

  for (let index = 0; index < overflowTeams.length; index++) {
    numberedTeams.push({
      team: overflowTeams[index],
      teamNumber: index + 1,
      asOverflow: true,
      lobby: null
    });
  }

  return numberedTeams;
}

async function scanSignupTeams(channel, guild, {
  requiredTeamSize,
  twoLobbies,
  includeBanned = false,
  postRejections = false
}) {
  let eventBanRows = [];

  try {
    eventBanRows = await getRows();
  } catch (err) {
    err.code = "EVENT_BAN_SHEET";
    throw err;
  }

  const messages =
    await channel.messages.fetch({
      limit: MESSAGE_SCAN_LIMIT
    });

  const eligibleTeams = [];
  const flaggedTeams = [];
  const candidateTeams = [];
  const playerSignupMap = new Map();

  const orderedMessages =
    [...messages.values()].reverse();

  for (const msg of orderedMessages) {
    const users =
      [...msg.mentions.users.values()]
        .filter(u => !u.bot);

    if (users.length === 0) {
      continue;
    }

    if (twoLobbies) {
      if (users.length < 1 || users.length > 4) {
        continue;
      }
    } else if (users.length !== requiredTeamSize) {
      continue;
    }

    candidateTeams.push({
      message: msg,
      users
    });

    for (const user of users) {
      if (!playerSignupMap.has(user.id)) {
        playerSignupMap.set(user.id, []);
      }

      playerSignupMap.get(user.id).push(msg.id);
    }
  }

  const duplicatePlayers = new Set();

  for (const [id, signups] of playerSignupMap) {
    if (signups.length > 1) {
      duplicatePlayers.add(id);
    }
  }

  let tierRejectedCount = 0;

  for (const team of candidateTeams) {
    const hasDuplicate =
      team.users.some(u => duplicatePlayers.has(u.id));

    if (hasDuplicate) {
      if (postRejections) {
        const dupes = team.users.filter(
          u => duplicatePlayers.has(u.id)
        );

        try {
          await channel.send(
            dupes.length === 1
              ? `<@${dupes[0].id}> player is signed up twice!`
              : `${dupes.map(u => `<@${u.id}>`).join(" ")} players are signed up twice!`
          );
        } catch {}
      }

      continue;
    }

    const teamSizeForTier =
      twoLobbies
        ? team.users.length
        : requiredTeamSize;

    if (teamSizeForTier > 1) {
      const tierCheck = await validateTeamTierCombo(
        guild,
        team.users,
        teamSizeForTier
      );

      if (!tierCheck.ok) {
        tierRejectedCount++;

        if (postRejections) {
          try {
            await channel.send(
              formatInvalidTierSignupMessage({
                users: team.users,
                tiers: tierCheck.tiers,
                teamSize: teamSizeForTier,
                reason: tierCheck.reason,
                ambiguousUser: tierCheck.ambiguousUser
              })
            );
          } catch {}
        }

        continue;
      }
    }

    let blockReason = null;

    for (const user of team.users) {
      blockReason = getSignupBlockReason(
        user.id,
        eventBanRows
      );

      if (blockReason) {
        break;
      }
    }

    if (blockReason) {
      flaggedTeams.push({
        team,
        blockReason
      });
      continue;
    }

    eligibleTeams.push(team);
  }

  const eligibleMessageIds = new Set(
    eligibleTeams.map(team => team.message.id)
  );
  const flaggedByMessageId =
    buildFlaggedTeamLookup(flaggedTeams);

  const { validTeams, skippedBannedTeams } =
    resolveValidTeamsInSignupOrder(
      candidateTeams,
      eligibleMessageIds,
      flaggedByMessageId,
      includeBanned
    );

  return {
    candidateTeams,
    eligibleTeams,
    flaggedTeams,
    validTeams,
    skippedBannedTeams,
    tierRejectedCount
  };
}

function findTeamByNumber(numberedTeams, teamNumber) {
  return numberedTeams.filter(
    entry => entry.teamNumber === teamNumber
  );
}

const ACCEPTED_EMOJI_ID = "1405510864496361482";
const RELOAD_STOP_EMOJI = "✋";
const RELOAD_K_EMOJI = "1435978450958553130";
const RULES_ACK_EMOJI_ID = require("../lib/rulesAcknowledgement").RULES_ACK_EMOJI_ID;

const NUMBER_EMOJIS = {
  "0": "1405509686194864188",
  "1": "1405509032705392685",
  "2": "1405509125500309636",
  "3": "1405509179291992165",
  "4": "1405509225144389734",
  "5": "1405509441054572577",
  "6": "1405509486533148763",
  "7": "1405509549246386218",
  "8": "1405509615529230347",
  "9": "1405509655702274210"
};

const DUPLICATE_NUMBER_EMOJIS = {
  "1": "1436347038630416499",
  "2": "1436348495102480424",
  "3": "1436348527448952923",
  "4": "1436348563591266424",
  "5": "1436348591986708601",
  "6": "1436348649616707695",
  "7": "1436348677341053069",
  "8": "1436348705652478004",
  "9": "1436348734731587645"
};

function getNumberReactionEmojis(number) {
  const digits = number.toString().split("");
  const digitUsage = {};
  const emojis = [];

  for (const digit of digits) {
    if (!digitUsage[digit]) {
      digitUsage[digit] = 0;
    }

    digitUsage[digit]++;

    const emoji =
      digitUsage[digit] === 1
        ? NUMBER_EMOJIS[digit]
        : DUPLICATE_NUMBER_EMOJIS[digit];

    if (emoji) {
      emojis.push(emoji);
    }
  }

  return emojis;
}

function reactionKey(emoji) {
  return emoji.id || emoji.name;
}

function buildExpectedReactionKeys(
  teamNumber,
  { asOverflow = false, acknowledged = false } = {}
) {
  const keys = asOverflow
    ? [
      RELOAD_STOP_EMOJI,
      RELOAD_K_EMOJI,
      ...getNumberReactionEmojis(teamNumber)
    ]
    : [
      ACCEPTED_EMOJI_ID,
      ...getNumberReactionEmojis(teamNumber)
    ];

  if (acknowledged) {
    keys.push(RULES_ACK_EMOJI_ID);
  }

  return keys.sort();
}

async function ensureMessageReactionsLoaded(message) {
  if (message.partial) {
    await message.fetch();
  }
}

function getMessageReactionKeysSorted(message) {
  const keys = [];

  for (const reaction of message.reactions.cache.values()) {
    if (reaction.count > 0) {
      keys.push(reactionKey(reaction.emoji));
    }
  }

  return keys.sort();
}

function teamSignupReactionsMatch(
  message,
  teamNumber,
  { asOverflow = false, acknowledged = false } = {}
) {
  const expected = buildExpectedReactionKeys(teamNumber, {
    asOverflow,
    acknowledged
  });
  const actual = getMessageReactionKeysSorted(message);

  if (expected.length !== actual.length) {
    return false;
  }

  return expected.every((key, index) => key === actual[index]);
}

async function findSignupMatchesByTeamNumber(channel, teamNumber) {
  const messages =
    await channel.messages.fetch({
      limit: MESSAGE_SCAN_LIMIT
    });

  const matches = [];

  for (const msg of [...messages.values()].reverse()) {
    const users =
      [...msg.mentions.users.values()]
        .filter(u => !u.bot);

    if (users.length === 0) {
      continue;
    }

    await ensureMessageReactionsLoaded(msg);

    for (const asOverflow of [false, true]) {
      for (const acknowledged of [false, true]) {
        if (
          teamSignupReactionsMatch(
            msg,
            teamNumber,
            { asOverflow, acknowledged }
          )
        ) {
          matches.push({
            team: {
              message: msg,
              users
            },
            asOverflow,
            acknowledged
          });
        }
      }
    }
  }

  return matches;
}

function isTeamInValidSignups(validTeams, messageId) {
  return validTeams.some(
    team => team.message.id === messageId
  );
}

async function resolveValidSignupByTeamNumber(
  channel,
  guild,
  teamNumber,
  scanOptions
) {
  const scanResult = await scanSignupTeams(
    channel,
    guild,
    scanOptions
  );

  const numberedTeams = buildNumberedTeams(
    scanResult.validTeams,
    scanOptions
  );
  const numberedMatches = findTeamByNumber(
    numberedTeams,
    teamNumber
  );

  if (numberedMatches.length === 1) {
    return {
      ...scanResult,
      match: numberedMatches[0],
      matchSource: "numbered"
    };
  }

  if (numberedMatches.length > 1) {
    return {
      ...scanResult,
      matches: numberedMatches,
      matchSource: "numbered_ambiguous"
    };
  }

  const reactionMatches =
    await findSignupMatchesByTeamNumber(
      channel,
      teamNumber
    );

  if (reactionMatches.length === 1) {
    const reactionMatch = reactionMatches[0];

    if (
      !isTeamInValidSignups(
        scanResult.validTeams,
        reactionMatch.team.message.id
      )
    ) {
      return {
        ...scanResult,
        matchSource: "invalid_signup"
      };
    }

    return {
      ...scanResult,
      match: reactionMatch,
      matchSource: "reactions"
    };
  }

  if (reactionMatches.length > 1) {
    return {
      ...scanResult,
      matches: reactionMatches,
      matchSource: "reactions_ambiguous"
    };
  }

  return {
    ...scanResult,
    matchSource: "not_found"
  };
}

module.exports = {
  MESSAGE_SCAN_LIMIT,
  TEAM_LIMITS,
  buildNumberedTeams,
  findTeamByNumber,
  findSignupMatchesByTeamNumber,
  resolveValidSignupByTeamNumber,
  scanSignupTeams
};
