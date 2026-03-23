const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");

const TWITCH_REGEX = /twitch\.tv\/([a-zA-Z0-9_]+)/gi;
const ACCEPTED_EMOJI_ID = "1405510864496361482";

/**
 * Safely fetch all messages from a channel
 */
async function fetchAllMessages(channel) {
  try {
    // Handle threads
    if (channel.isThread?.()) {
      try {
        await channel.join();
      } catch (e) {
        console.log(`❌ Cannot join thread ${channel.id}`);
        return [];
      }
    }

    // Permission checks
    const perms = channel.permissionsFor(channel.client.user);

    if (!perms?.has(PermissionFlagsBits.ViewChannel)) {
      console.log(`❌ Missing ViewChannel in ${channel.id}`);
      return [];
    }

    if (!perms?.has(PermissionFlagsBits.ReadMessageHistory)) {
      console.log(`❌ Missing ReadMessageHistory in ${channel.id}`);
      return [];
    }

    let messages = [];
    let lastId;

    while (true) {
      const options = { limit: 100 };
      if (lastId) options.before = lastId;

      let batch;
      try {
        batch = await channel.messages.fetch(options);
      } catch (err) {
        console.log(`❌ Fetch failed in ${channel.id}:`, err.code);
        break;
      }

      if (!batch.size) break;

      messages.push(...batch.values());
      lastId = batch.last().id;
    }

    return messages.reverse();

  } catch (err) {
    console.error("❌ Unexpected fetch error:", err);
    return [];
  }
}

/**
 * Extract teams from signup channel
 */
async function getTeams(signupChannel) {
  const messages = await fetchAllMessages(signupChannel);
  const teams = [];

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const reactions = msg.reactions.cache;

    const accepted = reactions.some(
      r => r.emoji.id === ACCEPTED_EMOJI_ID && r.count > 0
    );

    if (!accepted) continue;

    const members = [...msg.mentions.users.values()].map(u => u.id);

    if (members.length >= 1) {
      teams.push({
        number: teams.length + 1,
        members
      });
    }
  }

  return teams;
}

/**
 * Extract users who posted Twitch links
 */
async function getStreamPosters(streamChannel) {
  const messages = await fetchAllMessages(streamChannel);
  const posters = new Set();

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const matches = msg.content.match(TWITCH_REGEX);
    if (!matches) continue;

    const isStaff = msg.member?.permissions?.has(PermissionFlagsBits.ManageRoles);
    const batchMode = isStaff && matches.length > 5;

    if (!batchMode) posters.add(msg.author.id);
  }

  return posters;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("teamstreamcheck")
    .setDescription("Check which accepted teams have not submitted a stream")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    try {
      // 🔧 Handle threads properly
      const baseChannel = interaction.channel.isThread?.()
        ? interaction.channel.parent
        : interaction.channel;

      const category = baseChannel?.parent;

      if (!category) {
        return interaction.reply({
          content: "This command must be used inside an event category.",
          ephemeral: true
        });
      }

      console.log("📁 Category:", category.id);

      // 🔧 Safer channel resolution (not just cache)
      let signupChannel = category.children.cache.find(c => {
        if (!c.isTextBased()) return false;

        const name = c.name.toLowerCase();
        return (
          name.includes("sign-ups") ||
          name.includes("signups") ||
          name.includes("teams")
        );
      });

      // Fallback: fetch channels if not cached
      if (!signupChannel) {
        console.log("⚠️ Signup channel not in cache, fetching...");
        const fetched = await interaction.guild.channels.fetch();

        signupChannel = fetched.find(c => {
          if (c.parentId !== category.id) return false;
          if (!c.isTextBased()) return false;

          const name = c.name.toLowerCase();
          return (
            name.includes("sign-ups") ||
            name.includes("signups") ||
            name.includes("teams")
          );
        });
      }

      if (!signupChannel) {
        return interaction.reply({
          content: "Could not find a sign-ups channel in this category.",
          ephemeral: true
        });
      }

      console.log("📝 Signup Channel:", signupChannel.id);
      console.log("📺 Stream Channel:", interaction.channel.id);

      await interaction.reply("Scanning accepted teams and stream submissions...");

      const teams = await getTeams(signupChannel);
      const posters = await getStreamPosters(interaction.channel);

      const missingTeams = [];

      teams.forEach(team => {
        const hasStream = team.members.some(member => posters.has(member));
        if (!hasStream) missingTeams.push(team.number);
      });

      let message = `📺 **Team Stream Check**\n\n`;

      if (missingTeams.length) {
        message += `Teams Missing Stream (${missingTeams.length})\n\n`;

        missingTeams.forEach(num => {
          message += `Team ${num}\n`;
        });
      } else {
        message += `All accepted teams have at least one stream submitted.`;
      }

      await interaction.followUp(message);

    } catch (error) {
      console.error("❌ teamstreamcheck error:", error);

      if (!interaction.replied) {
        await interaction.reply({
          content: "Something went wrong while running this command.",
          ephemeral: true
        });
      }
    }
  }
};