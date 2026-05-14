const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const TWITCH_REGEX = /twitch\.tv\/([a-zA-Z0-9_]+)/gi;
const ACCEPTED_EMOJI_ID = "1405510864496361482";

async function fetchAllMessages(channel) {
  try {
    if (!channel.viewable) return [];

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

    const perms = channel.permissionsFor(channel.client.user);

    if (
      !perms?.has(PermissionFlagsBits.ViewChannel) ||
      !perms?.has(PermissionFlagsBits.ReadMessageHistory)
    ) {
      return [];
    }

    const messages = [];
    let lastId;

    while (true) {
      const options = { limit: 100 };

      if (lastId) {
        options.before = lastId;
      }

      let batch;

      try {
        batch = await channel.messages.fetch(options);
      } catch {
        break;
      }

      if (!batch.size) break;

      messages.push(...batch.values());
      lastId = batch.last().id;
    }

    return messages.reverse();

  } catch (err) {
    console.error("❌ Fetch error:", err);
    return [];
  }
}

async function getTeams(signupChannel) {
  const messages = await fetchAllMessages(signupChannel);
  const teams = [];

  for (const msg of messages) {
    if (msg.author.bot) continue;

    let accepted = false;

    try {
      await msg.reactions.fetch();

      const acceptedReaction =
        msg.reactions.cache.find(
          reaction =>
            reaction.emoji.id === ACCEPTED_EMOJI_ID
        );

      if (acceptedReaction?.count > 0) {
        accepted = true;
      }

    } catch (err) {
      console.log(`⚠️ Failed reaction fetch: ${msg.id}`);
    }

    if (!accepted) continue;

    const members = msg.mentions.users.size
      ? [...msg.mentions.users.keys()]
      : [];

    if (!members.length) continue;

    teams.push({
      number: teams.length + 1,
      members
    });
  }

  console.log(`✅ Teams detected: ${teams.length}`);

  return teams;
}

async function getSubmittedStreams(streamChannel) {
  const messages = await fetchAllMessages(streamChannel);

  const submissions = new Map();

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const matches = [
      ...msg.content.matchAll(TWITCH_REGEX)
    ];

    if (!matches.length) continue;

    const isStaff =
      msg.member?.permissions?.has(
        PermissionFlagsBits.ManageRoles
      );

    const batchMode =
      isStaff && matches.length > 5;

    if (batchMode) continue;

    if (!submissions.has(msg.author.id)) {
      submissions.set(msg.author.id, new Set());
    }

    const userStreams = submissions.get(msg.author.id);

    for (const match of matches) {
      userStreams.add(match[1].toLowerCase());
    }
  }

  return submissions;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("teams