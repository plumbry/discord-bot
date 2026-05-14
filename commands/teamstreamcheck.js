const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const TWITCH_REGEX = /twitch\.tv\/([a-zA-Z0-9_]+)/gi;
const ACCEPTED_EMOJI_ID = "1405510864496361482";

async function fetchAllMessages(channel) {
  try {
    if (!channel?.viewable) return [];

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
      if (lastId) options.before = lastId;

      const batch = await channel.messages.fetch(options);

      if (!batch.size) break;

      messages.push(...batch.values());
      lastId = batch.last()?.id;
    }

    return messages.reverse();

  } catch (err) {
    console.error("❌ fetchAllMessages:", err);
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
      // Force historical reactions to load
      await msg.reactions.fetch();

      for (const reaction of msg.reactions.cache.values()) {
        if (
          reaction.emoji.id !==
          ACCEPTED_EMOJI_ID
        ) continue;

        const users = await reaction.users.fetch();

        if (users.size > 0) {
          accepted = true;
          break;
        }
      }

    } catch (err) {
      console.log(
        `⚠️ Failed reaction fetch for ${msg.id}`
      );
    }

    if (!accepted) continue;

    // Include signup author + teammates
    const members = [
      msg.author.id,
      ...msg.mentions.users.keys()
    ];

    const uniqueMembers = [
      ...new Set(members)
    ];

    teams.push({
      number: teams.length + 1,
      members: uniqueMembers
    });
  }

  console.log(`✅ Teams detected: ${teams.length}`);

  return teams;
}

async function getStreamPosts(streamChannel) {
  const messages = await fetchAllMessages(streamChannel);

  return messages
    .filter(msg => {
      if (msg.author.bot) return false;

      const links = [...msg.content.matchAll(TWITCH_REGEX)];
      if (!links.length) return false;

      const isStaff = msg.member?.permissions?.has(
        PermissionFlagsBits.ManageRoles
      );

      return !(isStaff && links.length > 5);
    })
    .map(msg => ({
      authorId: msg.author.id,
      linkCount: [...msg.content.matchAll(TWITCH_REGEX)].length
    }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("teamstreamcheck")
    .setDescription("Check accepted teams for missing streams")
    .addStringOption(option =>
      option
        .setName("gamemode")
        .setDescription("Select event mode")
        .setRequired(true)
        .addChoices(
          { name: "Duos/Trios", value: "smallteam" },
          { name: "Squads", value: "squads" }
        )
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    ),

  async execute(interaction) {
    try {
      const required =
        interaction.options.getString("gamemode") === "squads"
          ? 2
          : 1;

      const baseChannel = interaction.channel.isThread?.()
        ? interaction.channel.parent
        : interaction.channel;

      const category = baseChannel?.parent;

      if (!category) {
        return interaction.reply({
          content: "Must be run inside an event category.",
          ephemeral: true
        });
      }

      const channels = await interaction.guild.channels.fetch();

      const signupChannel = channels.find(c => {
        if (c.parentId !== category.id) return false;
        if (!c.isTextBased()) return false;
        if (!c.viewable) return false;

        const name = c.name.toLowerCase();

        const isSignup =
          name.includes("sign");

        const isSolo =
          name.includes("solo") ||
          name.includes("lfg") ||
          name.includes("free-agent");

        return isSignup && !isSolo;
      });

      console.log(
        `Using signup channel: ${signupChannel?.name || "NONE"}`
      );

      if (!signupChannel) {
        return interaction.reply({
          content: "Signup channel not found.",
          ephemeral: true
        });
      }

      await interaction.reply("Scanning...");

      const teams = await getTeams(signupChannel);

      if (!teams.length) {
        return interaction.followUp("❌ No accepted teams detected");
      }

      const streamPosts = await getStreamPosts(baseChannel);

      const missing = [];

      for (const team of teams) {
        let total = 0;

        for (const post of streamPosts) {
          if (!team.members.includes(post.authorId)) continue;

          total += Math.min(post.linkCount, 2);

          if (total >= required) break;
        }

        console.log(`Team ${team.number}: ${total}/${required}`);

        if (total < required) {
          missing.push({
            number: team.number,
            count: total
          });
        }
      }

      let output = `📺 **Team Stream Check**\n\n`;

      if (missing.length) {
        output += `Teams Missing Streams (${missing.length})\n\n`;

        for (const team of missing) {
          output += `Team ${team.number} (${team.count}/${required})\n`;
        }
      } else {
        output += "All accepted teams submitted enough streams.";
      }

      await interaction.followUp(output);

    } catch (err) {
      console.error("❌ teamstreamcheck:", err);
    }
  }
};
