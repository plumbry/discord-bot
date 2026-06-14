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

function parseUntaggedSlots(content, requiredTeamSize) {
  if (!content?.trim()) {
    return null;
  }

  if (contentHasPlaceholderSignup(content)) {
    return null;
  }

  if (requiredTeamSize === 1) {
    const name = content.trim().split(/\n/)[0].trim();

    if (!name || USER_MENTION_SLOT_PATTERN.test(name)) {
      return null;
    }

    return [name];
  }

  if (!SIGNUP_SLOT_SEPARATOR.test(content)) {
    return null;
  }

  const slots = content
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

function messageHasValidUntaggedFormat(message, requiredTeamSize) {
  if (messageHasMentions(message)) {
    return false;
  }

  const slots = parseUntaggedSlots(message.content, requiredTeamSize);

  return slots !== null && slots.length === requiredTeamSize;
}

async function resolveUntaggedTeamUsers(
  message,
  requiredTeamSize,
  guild,
  sessionCache
) {
  const slots = parseUntaggedSlots(message.content, requiredTeamSize);

  if (!slots) {
    return { ok: false, reason: "invalid_format" };
  }

  const users = [];

  for (const slot of slots) {
    const resolved = await resolveSignupNameFromGuild(
      guild,
      slot,
      sessionCache
    );

    if (!resolved.ok) {
      return {
        ok: false,
        reason: resolved.reason,
        slot,
        matches: resolved.matches
      };
    }

    users.push(resolved.member.user);
  }

  return { ok: true, users };
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
      const resolved = await resolveUntaggedTeamUsers(
        message,
        requiredTeamSize,
        guild,
        sessionCache
      );

      if (resolved.ok) {
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
  if (resolved.reason === "not_found") {
    return `Could not find a member named **${resolved.slot}**. Check spelling or use @mentions with /roletagged.`;
  }

  if (resolved.reason === "ambiguous") {
    const options = resolved.matches
      .map(member => `<@${member.id}>`)
      .join(" ");

    return (
      `Ambiguous signup name **${resolved.slot}** — multiple members match: ${options}\n` +
      "Use a unique name or @mention with /roletagged."
    );
  }

  return null;
}

module.exports = {
  createNameResolveSession,
  formatUnresolvedSignupMessage,
  looksLikeUntaggedSignupAttempt,
  messageHasMentions,
  messageHasValidUntaggedFormat,
  parseUntaggedSlots,
  resolveUntaggedTeamUsers,
  syncInvalidUntaggedSignupReactions
};
