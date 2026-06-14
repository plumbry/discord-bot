const {
  getNonBotMentionedUsers,
  contentHasPlaceholderSignup,
  syncMessageToHandReaction
} = require("./signupTeamScan");

const SIGNUP_SLOT_SEPARATOR = /\s+x\s+/i;
const USER_MENTION_SLOT_PATTERN = /^<@!?(\d+)>$/;

function normalizeSignupName(value) {
  return value
    .replace(/\*\*/g, "")
    .replace(/^[-*•\d.)\s]+/, "")
    .trim()
    .toLowerCase();
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

function buildMemberNameLookup(guild) {
  const lookup = new Map();

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) {
      continue;
    }

    const names = new Set([
      member.user.username,
      member.user.globalName,
      member.displayName,
      member.nickname
    ].filter(Boolean));

    for (const name of names) {
      const key = normalizeSignupName(name);

      if (!key) {
        continue;
      }

      if (!lookup.has(key)) {
        lookup.set(key, []);
      }

      const list = lookup.get(key);

      if (!list.some(existing => existing.id === member.id)) {
        list.push(member);
      }
    }
  }

  return lookup;
}

function resolveSignupName(name, lookup) {
  const key = normalizeSignupName(name);

  if (!key) {
    return { ok: false, reason: "empty" };
  }

  const matches = lookup.get(key) || [];

  if (matches.length === 0) {
    return { ok: false, reason: "not_found", name };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      name,
      matches
    };
  }

  return {
    ok: true,
    member: matches[0]
  };
}

function resolveUntaggedTeamUsers(message, requiredTeamSize, lookup) {
  const slots = parseUntaggedSlots(message.content, requiredTeamSize);

  if (!slots) {
    return { ok: false, reason: "invalid_format" };
  }

  const users = [];

  for (const slot of slots) {
    const resolved = resolveSignupName(slot, lookup);

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
  lookup
) {
  let synced = 0;

  for (const message of messages) {
    if (!looksLikeUntaggedSignupAttempt(message)) {
      continue;
    }

    if (messageHasValidUntaggedFormat(message, requiredTeamSize)) {
      const resolved = resolveUntaggedTeamUsers(
        message,
        requiredTeamSize,
        lookup
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
  buildMemberNameLookup,
  formatUnresolvedSignupMessage,
  looksLikeUntaggedSignupAttempt,
  messageHasMentions,
  messageHasValidUntaggedFormat,
  parseUntaggedSlots,
  resolveUntaggedTeamUsers,
  syncInvalidUntaggedSignupReactions
};
