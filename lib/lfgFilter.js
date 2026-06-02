const { MessageType } = require("discord.js");

/**
 * True if this message is a reply to another message (not a top-level LFG post).
 */
function isReplyToAnother(message) {
  if (message.reference?.messageId) {
    return true;
  }

  return message.type === MessageType.Reply;
}

const FOR_TODAY =
  /\bfor\s+(?:today|tdy|tonight)\b/i;
const EXPLICIT_WHEN =
  /\b(today|tonight|tdy|tmr|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;

/**
 * Top-level LFG posts: need slots, n1 shorthand, fill offers, lfg/lfN, etc.
 * "need a teammate" only counts when paired with an explicit day.
 */
function looksLikeLfgPost(text) {
  const lower = text.toLowerCase().trim();

  if (lower.length < 2) {
    return false;
  }

  const wantsTeammate =
    /\bneed(?:s)?\s+(?:a\s+)?teammates?\b/.test(lower) ||
    /\blooking\s+for\s+(?:a\s+)?teammates?\b/.test(lower) ||
    /\blfg\s+(?:a\s+)?teammates?\b/.test(lower);

  if (wantsTeammate) {
    return FOR_TODAY.test(lower) || EXPLICIT_WHEN.test(lower);
  }

  if (/\bneed(?:s)?\s+(?:[1-3]|\d+)\b/.test(lower)) {
    return true;
  }

  if (
    /\bneed\s+a\s+(?:[sabc]\s+)?tier\b/.test(lower) ||
    /\bneed\s+a\s+tier\s+[sabc]\b/.test(lower) ||
    /\bneed\s+a\s+(?:girl|guy|boy|woman|man)\b/.test(lower) ||
    /\bneed\s+a\s+(?:[sabc]\s+)?tier\s+(?:girl|guy|boy|girls?|guys?|boys?|woman|women|man|men)\b/.test(
      lower
    )
  ) {
    return true;
  }

  if (/\bn\s*[1-3]\b/.test(lower) || /\bn[1-3]\b/.test(lower)) {
    return true;
  }

  if (/\bneed(?:s)?\s+(?:a\s+)?fill\b/.test(lower)) {
    return true;
  }

  if (
    /\b(?:can|could|will|i'?ll|happy\s+to|down\s+to)\s+fill\b/.test(lower) ||
    /\bfill\s+(?:in|if)\b/.test(lower) ||
    /\bif\s+(?:anyone|anybody|someone)\s+needs?\s+(?:[1-3]|\d+)\b/.test(lower)
  ) {
    return true;
  }

  if (/\blfg\b/.test(lower) || /\blf\s*[1-3]\b/.test(lower) || /\blf[1-3]\b/.test(lower)) {
    return true;
  }

  if (
    /\blooking\s+for\s+(?:[1-3]|\d+|duo|trio|squad)\b/.test(lower)
  ) {
    return true;
  }

  if (/\+[1-3]\b/.test(lower)) {
    return true;
  }

  return false;
}

function isLfgCollateMessage(message) {
  if (isReplyToAnother(message)) {
    return false;
  }

  const text = message.content?.trim();

  if (!text) {
    return false;
  }

  return looksLikeLfgPost(text);
}

module.exports = {
  isReplyToAnother,
  looksLikeLfgPost,
  isLfgCollateMessage
};
