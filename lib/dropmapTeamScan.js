const {
  MESSAGE_SCAN_LIMIT,
  getNonBotMentionedUsers,
  ensureMessageReactionsLoaded,
  teamSignupReactionsMatch
} = require("./signupTeamScan");

const ACCEPTED_EMOJI_ID = "1405510864496361482";
const RELOAD_STOP_EMOJI = "✋";
const MAX_TEAM_NUMBER = 100;
const MENTION_PATTERN = /<@!?(\d{17,20})>/g;

function teamMemberKey(users) {
  return users
    .map(user => user.id)
    .sort()
    .join(",");
}

function usersFromMentionIds(message, mentionIds) {
  const users = [];

  for (const id of mentionIds) {
    const user = message.mentions.users.get(id);

    if (user && !user.bot) {
      users.push(user);
    }
  }

  return users;
}

function extractUsersFromLine(message, line) {
  const mentionIds = [...line.matchAll(MENTION_PATTERN)].map(match => match[1]);

  return usersFromMentionIds(message, mentionIds);
}

function messageLooksNumberedSignup(message) {
  for (const reaction of message.reactions.cache.values()) {
    if (reaction.count === 0) {
      continue;
    }

    const key = reaction.emoji.id || reaction.emoji.name;

    if (
      key === ACCEPTED_EMOJI_ID ||
      key === RELOAD_STOP_EMOJI
    ) {
      return true;
    }
  }

  return false;
}

function extractBulkLineTeams(message) {
  const lines = message.content
    .split(/\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [];
  }

  const teams = [];

  for (let index = 0; index < lines.length; index++) {
    const users = extractUsersFromLine(message, lines[index]);

    if (users.length === 0) {
      continue;
    }

    teams.push({
      number: null,
      lineIndex: index + 1,
      users,
      source: "bulk_list",
      messageId: message.id,
      label: `List line ${index + 1}`
    });
  }

  return teams;
}

async function extractNumberedTeams(message) {
  const users = getNonBotMentionedUsers(message);

  if (users.length === 0) {
    return [];
  }

  if (!messageLooksNumberedSignup(message)) {
    return [];
  }

  await ensureMessageReactionsLoaded(message);

  const teams = [];

  for (let teamNumber = 1; teamNumber <= MAX_TEAM_NUMBER; teamNumber++) {
    for (const asOverflow of [false, true]) {
      for (const acknowledged of [false, true]) {
        if (
          !teamSignupReactionsMatch(
            message,
            teamNumber,
            { asOverflow, acknowledged }
          )
        ) {
          continue;
        }

        teams.push({
          number: teamNumber,
          lineIndex: null,
          users,
          source: asOverflow ? "numbered_overflow" : "numbered",
          messageId: message.id,
          label: asOverflow
            ? `Overflow ${teamNumber}`
            : `Team ${teamNumber}`
        });

        return teams;
      }
    }
  }

  return teams;
}

function extractSingleMessageTeam(message) {
  const users = getNonBotMentionedUsers(message);

  if (users.length === 0) {
    return null;
  }

  return {
    number: null,
    lineIndex: null,
    users,
    source: "signup_message",
    messageId: message.id,
    label: "Signup message"
  };
}

async function collectTeamsFromSignupChannel(channel) {
  const messages = await channel.messages.fetch({
    limit: MESSAGE_SCAN_LIMIT
  });

  const teamsByKey = new Map();
  let fallbackCounter = 1;

  for (const message of messages.values()) {
    if (message.author?.bot) {
      continue;
    }

    const numberedTeams = await extractNumberedTeams(message);

    for (const team of numberedTeams) {
      teamsByKey.set(teamMemberKey(team.users), team);
    }

    const bulkTeams = extractBulkLineTeams(message);

    for (const team of bulkTeams) {
      const key = teamMemberKey(team.users);

      if (!teamsByKey.has(key)) {
        teamsByKey.set(key, team);
      }
    }

    if (numberedTeams.length === 0 && bulkTeams.length === 0) {
      const singleTeam = extractSingleMessageTeam(message);

      if (singleTeam) {
        const key = teamMemberKey(singleTeam.users);

        if (!teamsByKey.has(key)) {
          teamsByKey.set(key, singleTeam);
        }
      }
    }
  }

  const teams = [...teamsByKey.values()];

  teams.sort((a, b) => {
    if (a.number != null && b.number != null) {
      return a.number - b.number;
    }

    if (a.number != null) {
      return -1;
    }

    if (b.number != null) {
      return 1;
    }

    return (a.lineIndex || fallbackCounter) - (b.lineIndex || fallbackCounter);
  });

  return teams.map((team, index) => ({
    ...team,
    displayIndex: team.number ?? team.lineIndex ?? index + 1,
    label:
      team.label ||
      (team.number != null
        ? `Team ${team.number}`
        : team.lineIndex != null
          ? `List line ${team.lineIndex}`
          : `Team ${index + 1}`)
  }));
}

function collectTypistIds(messages) {
  const typistIds = new Set();

  for (const message of messages) {
    if (message.author?.bot) {
      continue;
    }

    if (!message.content?.trim()) {
      continue;
    }

    typistIds.add(message.author.id);
  }

  return typistIds;
}

function evaluateDropmapTeams(teams, typistIds) {
  const marked = [];
  const missing = [];

  for (const team of teams) {
    const marker = team.users.find(user => typistIds.has(user.id));

    if (marker) {
      marked.push({ team, marker });
    } else {
      missing.push(team);
    }
  }

  return { marked, missing };
}

function formatTeamNumber(team) {
  return `Team ${team.displayIndex}`;
}

function buildDropmapCheckReport({
  teams,
  marked,
  missing,
  signupChannel,
  dropmapChannel
}) {
  const lines = [
    `**Dropmap check** — ${teams.length} team(s) from ${signupChannel}`,
    `Dropmap activity in ${dropmapChannel}`,
    `Marked: **${marked.length}** · Missing: **${missing.length}**`,
    ""
  ];

  if (missing.length === 0) {
    lines.push("All teams have at least one member who typed in dropmap.");
    return lines.join("\n");
  }

  lines.push("**Missing dropmap (no teammate typed):**", "");

  for (const team of missing) {
    lines.push(formatTeamNumber(team));
  }

  return lines.join("\n");
}

function splitDiscordMessages(text, limit = 1900) {
  if (text.length <= limit) {
    return [text];
  }

  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    const next = current ? `${current}\n${line}` : line;

    if (next.length > limit) {
      if (current) {
        chunks.push(current);
      }

      if (line.length > limit) {
        chunks.push(line.slice(0, limit));
        current = line.slice(limit);
      } else {
        current = line;
      }
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

module.exports = {
  buildDropmapCheckReport,
  collectTeamsFromSignupChannel,
  collectTypistIds,
  evaluateDropmapTeams,
  splitDiscordMessages
};
