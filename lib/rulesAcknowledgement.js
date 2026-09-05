const { fetchAllMessages } = require("./messages");

const RULES_ACK_EMOJI_ID = "1442119380866433127";

const RULES_ACK_CHANNEL_NAME = "acknowledge-rules";

function isRulesAcknowledgementChannelName(name) {
  const normalized = String(name || "").toLowerCase();

  return (
    normalized === RULES_ACK_CHANNEL_NAME ||
    normalized.endsWith(`-${RULES_ACK_CHANNEL_NAME}`)
  );
}

function isCandidateRulesAckChannel(entry, categoryId) {
  if (entry.parentId !== categoryId) {
    return false;
  }

  if (!entry.isTextBased?.()) {
    return false;
  }

  if (!entry.viewable) {
    return false;
  }

  return isRulesAcknowledgementChannelName(entry.name);
}

function findRulesAcknowledgementChannel(guild, categoryId) {
  const matches = [...guild.channels.cache.values()].filter(entry =>
    isCandidateRulesAckChannel(entry, categoryId)
  );

  if (matches.length === 0) {
    return null;
  }

  return (
    matches.find(
      entry => entry.name.toLowerCase() === RULES_ACK_CHANNEL_NAME
    ) ?? matches[0]
  );
}

function isTeamAcknowledged(memberIds, acknowledgementMessages) {
  const required = new Set(memberIds);

  for (const message of acknowledgementMessages) {
    if (message.author.bot) {
      continue;
    }

    const mentioned = new Set(
      [...message.mentions.users.values()]
        .filter(user => !user.bot)
        .map(user => user.id)
    );

    if ([...required].every(id => mentioned.has(id))) {
      return true;
    }
  }

  return false;
}

async function loadRulesAcknowledgementMessages(rulesChannel) {
  if (!rulesChannel) {
    return [];
  }

  return fetchAllMessages(rulesChannel);
}

module.exports = {
  RULES_ACK_EMOJI_ID,
  findRulesAcknowledgementChannel,
  isRulesAcknowledgementChannelName,
  isTeamAcknowledged,
  loadRulesAcknowledgementMessages
};
