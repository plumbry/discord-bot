const {
  PermissionFlagsBits
} = require("discord.js");

/**
 * Paginate channel message history (oldest → newest).
 */
async function fetchAllMessages(
  channel,
  { maxMessages } = {}
) {

  try {

    if (!channel?.viewable) {
      return [];
    }

    if (channel.isThread?.()) {

      if (channel.archived) {

        try {
          await channel.setArchived(false);
        } catch {
          return [];
        }

      }

      try {
        await channel.join();
      } catch {
        return [];
      }

    }

    const perms =
      channel.permissionsFor(channel.client.user);

    if (
      !perms?.has(PermissionFlagsBits.ViewChannel) ||
      !perms?.has(PermissionFlagsBits.ReadMessageHistory)
    ) {
      return [];
    }

    const messages = [];
    let lastId;

    while (true) {

      if (
        maxMessages &&
        messages.length >= maxMessages
      ) {
        break;
      }

      const options = { limit: 100 };

      if (lastId) {
        options.before = lastId;
      }

      const batch =
        await channel.messages.fetch(options);

      if (!batch.size) {
        break;
      }

      messages.push(...batch.values());
      lastId = batch.last()?.id;

    }

    return messages.reverse();

  } catch (err) {

    console.error("fetchAllMessages:", err);
    return [];

  }

}

module.exports = {
  fetchAllMessages
};
