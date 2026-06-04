const { fetchAllMessages } = require("./messages");

const RULES_ACK_EMOJI_ID = "1442119380866433127";

const RULES_ACK_CHANNEL_NAME = "acknowledge-rules";

function findRulesAcknowledgementChannel(guild, categoryId) {
  const channel = guild.channels.cache.find(entry => {
    if (entry.parentId !== categoryId) {
      return false;
    }

    if (!entry.isTextBased?.()) {
      return false;
    }

    if (!entry.viewable) {
      return false;
    }

    return entry.name.toLowerCase() === RULES_ACK_CHANNEL_NAME;
  });

  return channel ?? null;
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
  isTeamAcknowledged,
  loadRulesAcknowledgementMessages
};
