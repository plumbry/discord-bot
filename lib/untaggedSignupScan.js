const {
  getNonBotMentionedUsers,
  contentHasPlaceholderSignup,
  syncMessageToHandReaction
} = require("./signupTeamScan");

const SIGNUP_SLOT_SEPARATOR = /\s+x\s+/i;
const USER_MENTION_SLOT_PATTERN = /^<@!?(\d+)>$/;
const MEMBER_SEARCH_DELAY_MS = 350;
const MEMBER_SEARCH_LIMIT = 100;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeSignupName(value) {
  return value
    .replace(/\*\*/g, "")
    .replace(/^[-*•\d.)\s]+/, "")
    .trim()
    .toLowerCase();
}

function createNameResolveSession() {
  return new Map();
}

function getMemberNameKeys(member) {
  return [
    member.user.username,
    member.user.globalName,
    member.displayName,
    member.nickname
  ]
    .filter(Boolean)
    .map(normalizeSignupName);
}

function findExactMatchesInCollection(members, key) {
  const matches = [];

  for (const member of members.values()) {
    if (member.user.bot) {
      continue;
    }

    if (getMemberNameKeys(member).includes(key)) {
      matches.push(member);
    }
  }

  return matches;
}

function buildSearchQueries(rawName) {
  const trimmed = rawName.trim();
  const queries = [];

  if (trimmed) {
    queries.push(trimmed.slice(0, 32));
  }

  const firstWord = trimmed.split(/\s+/)[0];

  if (firstWord && firstWord.length >= 2 && firstWord !== trimmed) {
    queries.push(firstWord.slice(0, 32));
  }

  return [...new Set(queries)];
}

async function searchMembersForName(guild, rawName) {
  const seen = new Set();
  const matches = [];

  for (const query of buildSearchQueries(rawName)) {
    let results;

    try {
      results = await guild.members.search({
        query,
        limit: MEMBER_SEARCH_LIMIT
      });
    } catch (err) {
      console.error(
        "[UNTAGGED SIGNUP] Member search failed:",
        query,
        err?.message || err
      );
      continue;
    }

    await delay(MEMBER_SEARCH_DELAY_MS);

    for (const member of results.values()) {
      if (!seen.has(member.id)) {
        seen.add(member.id);
        matches.push(member);
      }
    }
  }

  return matches;
}

async function resolveSignupNameFromGuild(guild, rawName, sessionCache) {
  const key = normalizeSignupName(rawName);

  if (!key) {
    return { ok: false, reason: "empty", slot: rawName };
  }

  if (sessionCache.has(key)) {
    return sessionCache.get(key);
  }

  let matches = findExactMatchesInCollection(
    guild.members.cache,
    key
  );

  if (matches.length === 0) {
    const searched = await searchMembersForName(guild, rawName);
    matches = findExactMatchesInCollection(
      searched,
      key
    );
  }

  let result;

  if (matches.length === 0) {
    result = {
      ok: false,
      reason: "not_found",
      name: rawName,
      slot: rawName
    };
  } else if (matches.length > 1) {
    result = {
      ok: false,
      reason: "ambiguous",
      name: rawName,
      slot: rawName,
      matches
    };
  } else {
    result = {
      ok: true,
      member: matches[0]
    };
  }

  sessionCache.set(key, result);
  return result;
}

function messageHasMentions(message) {
  return getNonBotMentionedUsers(message).length > 0;
}

function looksLikeUntaggedSignupAttempt(message) {
  if (message.author?.bot) {
    return false;
  }

  if (messageHasMentions(message)) {
    return false;
  }

  const content = message.content?.trim();

  if (!content) {
    return false;
  }

  if (SIGNUP_SLOT_SEPARATOR.test(content)) {
    return true;
  }

  if (contentHasPlaceholderSignup(content)) {
    return true;
  }

  return Boolean(content);
}

function splitContentIntoTeamLines(content) {
  return content
    .split(/\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function parseUntaggedSlotsFromLine(line, requiredTeamSize) {
  if (!line?.trim()) {
    return null;
  }

  if (contentHasPlaceholderSignup(line)) {
    return null;
  }

  if (requiredTeamSize === 1) {
    if (USER_MENTION_SLOT_PATTERN.test(line)) {
      return null;
    }

    return [line.trim()];
  }

  if (!SIGNUP_SLOT_SEPARATOR.test(line)) {
    return null;
  }

  const slots = line
    .split(SIGNUP_SLOT_SEPARATOR)
    .map(slot => slot.trim())
    .filter(Boolean);

  if (slots.length !== requiredTeamSize) {
    return null;
  }

  if (slots.some(slot => USER_MENTION_SLOT_PATTERN.test(slot))) {
    return null;
  }

  return slots;
}

function parseUntaggedTeamsFromMessage(content, requiredTeamSize) {
  const lines = splitContentIntoTeamLines(content);
  const teams = [];
  const invalidLines = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const slots = parseUntaggedSlotsFromLine(line, requiredTeamSize);

    if (slots) {
      teams.push({
        lineIndex: index + 1,
        line,
        slots
      });
    } else {
      invalidLines.push({
        lineIndex: index + 1,
        line
      });
    }
  }

  return { teams, invalidLines };
}

/** @deprecated Use parseUntaggedSlotsFromLine for a single team line. */
function parseUntaggedSlots(content, requiredTeamSize) {
  const lines = splitContentIntoTeamLines(content);

  if (lines.length !== 1) {
    return null;
  }

  return parseUntaggedSlotsFromLine(lines[0], requiredTeamSize);
}

function messageHasValidUntaggedFormat(message, requiredTeamSize) {
  if (messageHasMentions(message)) {
    return false;
  }

  return parseUntaggedTeamsFromMessage(
    message.content,
    requiredTeamSize
  ).teams.length > 0;
}

function buildUntaggedSignupKey(messageId, lineIndex) {
  return `${messageId}:${lineIndex}`;
}

async function resolveUntaggedTeamsFromMessage(
  message,
  requiredTeamSize,
  guild,
  sessionCache
) {
  const parsed = parseUntaggedTeamsFromMessage(
    message.content,
    requiredTeamSize
  );
  const teams = [];
  const failures = [];

  for (const team of parsed.teams) {
    const users = [];
    let failed = null;

    for (const slot of team.slots) {
      const resolved = await resolveSignupNameFromGuild(
        guild,
        slot,
        sessionCache
      );

      if (!resolved.ok) {
        failed = {
          ...resolved,
          line: team.line,
          lineIndex: team.lineIndex
        };
        break;
      }

      users.push(resolved.member.user);
    }

    if (failed) {
      failures.push(failed);
    } else {
      teams.push({
        lineIndex: team.lineIndex,
        line: team.line,
        slots: team.slots,
        users,
        signupKey: buildUntaggedSignupKey(
          message.id,
          team.lineIndex
        )
      });
    }
  }

  return {
    teams,
    failures,
    invalidLines: parsed.invalidLines
  };
}

/** Resolve a single team line from one message (legacy). */
async function resolveUntaggedTeamUsers(
  message,
  requiredTeamSize,
  guild,
  sessionCache
) {
  const result = await resolveUntaggedTeamsFromMessage(
    message,
    requiredTeamSize,
    guild,
    sessionCache
  );

  if (result.teams.length !== 1) {
    return { ok: false, reason: "invalid_format" };
  }

  return {
    ok: true,
    users: result.teams[0].users
  };
}

async function syncInvalidUntaggedSignupReactions(
  messages,
  requiredTeamSize,
  guild,
  sessionCache
) {
  let synced = 0;

  for (const message of messages) {
    if (!looksLikeUntaggedSignupAttempt(message)) {
      continue;
    }

    if (messageHasValidUntaggedFormat(message, requiredTeamSize)) {
      const resolved = await resolveUntaggedTeamsFromMessage(
        message,
        requiredTeamSize,
        guild,
        sessionCache
      );

      if (resolved.teams.length > 0) {
        continue;
      }
    }

    try {
      if (await syncMessageToHandReaction(message)) {
        synced++;
      }
    } catch (err) {
      console.error(
        "[UNTAGGED SIGNUP] Could not mark invalid signup:",
        message.id,
        err
      );
    }
  }

  return synced;
}

function formatUnresolvedSignupMessage(resolved) {
  const prefix =
    resolved.lineIndex !== undefined
      ? `Line ${resolved.lineIndex}: `
      : "";

  if (resolved.reason === "not_found") {
    return `${prefix}Could not find a member named **${resolved.slot}**. Check spelling or use @mentions with /roletagged.`;
  }

  if (resolved.reason === "ambiguous") {
    const options = resolved.matches
      .map(member => `<@${member.id}>`)
      .join(" ");

    return (
      `${prefix}Ambiguous signup name **${resolved.slot}** — multiple members match: ${options}\n` +
      "Use a unique name or @mention with /roletagged."
    );
  }

  return null;
}

module.exports = {
  buildUntaggedSignupKey,
  createNameResolveSession,
  formatUnresolvedSignupMessage,
  looksLikeUntaggedSignupAttempt,
  messageHasMentions,
  messageHasValidUntaggedFormat,
  parseUntaggedSlots,
  parseUntaggedSlotsFromLine,
  parseUntaggedTeamsFromMessage,
  resolveUntaggedTeamUsers,
  resolveUntaggedTeamsFromMessage,
  syncInvalidUntaggedSignupReactions
};
