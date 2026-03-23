const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

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
 * Extract teams from signup channel (robust)
 */
async function getTeams(signupChannel) {
  const messages = await fetchAllMessages(signupChannel);
  const teams = [];

  for (const msg of messages) {
    if (msg.author.bot) continue;

    let accepted = false;

    // Force accurate reaction check
    for (const reaction of msg.reactions.cache.values()) {
      if (reaction.emoji.id === ACCEPTED_EMOJI_ID) {
        try {
          const users = await reaction.users.fetch();
          if (users.size > 0) {
            accepted = true;
            break;
          }
        } catch (e) {
          console.log(`⚠️ Failed reaction fetch for message ${msg.id}`);
        }
      }
    }

    if (!accepted) continue;

    const members = msg.mentions.users.size
      ? [...msg.mentions.users.keys()]
      : [];

    if (members.length >= 1) {
      teams.push({
        number: messages.indexOf(msg) + 1, // stable numbering
        members
      });
    } else {
      console.log(`⚠️ No members found in message ${msg.id}`);
    }
  }

  console.log(`✅ Teams detected: ${teams.length}`);
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
      // Handle threads properly
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

      console.log("📁 Category:", category.name);

      // Find signup channel (EXCLUDING solo channels)
      let signupChannel = category.children.cache.find(c => {
        if (!c.isTextBased()) return false;

        const name = c.name.toLowerCase();

        const isSignup =
          name.includes("sign-ups") ||
          name.includes("signups") ||
          name.includes("teams");

        const isSolo =
          name.includes("solo") ||
          name.includes("lfg") ||
          name.includes("free-agent");

        return isSignup && !isSolo;
      });

      // Fallback if not cached
      if (!signupChannel) {
        console.log("⚠️ Signup not in cache, fetching...");
        const fetched = await interaction.guild.channels.fetch();

        signupChannel = fetched.find(c => {
          if (c.parentId !== category.id) return false;
          if (!c.isTextBased()) return false;

          const name = c.name.toLowerCase();

          const isSignup =
            name.includes("sign-ups") ||
            name.includes("signups") ||
            name.includes("teams");

          const isSolo =
            name.includes("solo") ||
            name.includes("lfg") ||
            name.includes("free-agent");

          return isSignup && !isSolo;
        });
      }

      if (!signupChannel) {
        return interaction.reply({
          content: "Could not find a team sign-ups channel in this category.",
          ephemeral: true
        });
      }

      console.log("📝 Using signup channel:", signupChannel.name);
      console.log("📺 Using stream channel:", interaction.channel.name);

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