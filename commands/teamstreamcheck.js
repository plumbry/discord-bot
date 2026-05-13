const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const TWITCH_REGEX = /twitch\.tv\/([a-zA-Z0-9_]+)/gi;
const ACCEPTED_EMOJI_ID = "1405510864496361482";

/**
 * Safely fetch all messages from a channel
 */
async function fetchAllMessages(channel) {
  try {
    if (!channel.viewable) {
      console.log(`❌ Channel not viewable: ${channel.id}`);
      return [];
    }

    // Handle threads
    if (channel.isThread?.()) {
      if (channel.archived) {
        try {
          await channel.setArchived(false);
        } catch {
          console.log(`❌ Cannot unarchive thread ${channel.id}`);
          return [];
        }
      }

      try {
        await channel.join();
      } catch {
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
 * Extract teams from signup channel
 */
async function getTeams(signupChannel) {
  const messages = await fetchAllMessages(signupChannel);
  const teams = [];

  for (const msg of messages) {
    if (msg.author.bot) continue;

    let accepted = false;

    for (const reaction of msg.reactions.cache.values()) {
      if (reaction.emoji.id === ACCEPTED_EMOJI_ID) {
        try {
          const users = await reaction.users.fetch();

          if (users.size > 0) {
            accepted = true;
            break;
          }

        } catch {
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
        number: messages.indexOf(msg) + 1,
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

    const isStaff =
      msg.member?.permissions?.has(PermissionFlagsBits.ManageRoles);

    const batchMode = isStaff && matches.length > 5;

    // Ignore bulk staff reposts
    if (!batchMode) {
      posters.add(msg.author.id);
    }
  }

  return posters;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("teamstreamcheck")
    .setDescription("Check which accepted teams have not submitted enough streams")
    .addStringOption(option =>
      option
        .setName("gamemode")
        .setDescription("Select the event gamemode")
        .setRequired(true)
        .addChoices(
          { name: "Duos/Trios", value: "smallteam" },
          { name: "Squads", value: "squads" }
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    try {
      const gamemode = interaction.options.getString("gamemode");

      const requiredStreams =
        gamemode === "squads"
          ? 2
          : 1;

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

      const fetched = await interaction.guild.channels.fetch();

      console.log("📂 Channels in category:");

      fetched.forEach(c => {
        if (c.parentId === category.id) {
          console.log(
            `- ${c.name} | viewable=${c.viewable} | type=${c.type}`
          );
        }
      });

      // Find signup channel
      const signupChannel = fetched.find(c => {
        if (c.parentId !== category.id) return false;
        if (!c.isTextBased()) return false;
        if (!c.viewable) return false;

        const name = c.name.toLowerCase();

        const isSignup = name.includes("sign");

        const isSolo =
          name.includes("solo") ||
          name.includes("lfg") ||
          name.includes("free-agent");

        return isSignup && !isSolo;
      });

      if (!signupChannel) {
        return interaction.reply({
          content: "No valid signup channel found.",
          ephemeral: true
        });
      }

      console.log("📝 Using signup channel:", {
        name: signupChannel.name,
        id: signupChannel.id,
        viewable: signupChannel.viewable
      });

      const streamChannel = interaction.channel.isThread?.()
        ? interaction.channel.parent
        : interaction.channel;

      console.log("📺 Using stream channel:", streamChannel.name);

      await interaction.reply(
        `Scanning accepted teams (${requiredStreams} stream(s) required)...`
      );

      const teams = await getTeams(signupChannel);
      const posters = await getStreamPosters(streamChannel);

      const missingTeams = [];

      teams.forEach(team => {
        const streamerCount = team.members.filter(member =>
          posters.has(member)
        ).length;

        if (streamerCount < requiredStreams) {
          missingTeams.push({
            number: team.number,
            count: streamerCount
          });
        }
      });

      let message = `📺 **Team Stream Check**\n\n`;
      message += `Gamemode: ${
        gamemode === "squads"
          ? "Squads"
          : "Duos/Trios"
      }\n`;

      message += `Required Streams Per Team: ${requiredStreams}\n\n`;

      if (missingTeams.length) {
        message += `Teams Missing Streams (${missingTeams.length})\n\n`;

        missingTeams.forEach(team => {
          message += `Team ${team.number} (${team.count}/${requiredStreams})\n`;
        });

      } else {
        message += `All accepted teams submitted enough streams.`;
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