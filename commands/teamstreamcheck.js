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
      const batch = await channel.messages.fetch({
        limit: 100,
        before: lastId
      });

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

    try {
      await msg.reactions.fetch();

      const acceptedReaction =
        msg.reactions.cache.find(
          r => r.emoji.id === ACCEPTED_EMOJI_ID
        );

      if (
        !acceptedReaction ||
        acceptedReaction.count < 1
      ) {
        continue;
      }

      const members = [
        msg.author.id,
        ...msg.mentions.users.map(user => user.id)
      ];

      const uniqueMembers = [...new Set(members)];

      teams.push({
        number: teams.length + 1,
        members: uniqueMembers
      });

    } catch (err) {
      console.log(`⚠️ Failed parsing ${msg.id}`);
    }
  }

  console.log(`✅ Detected ${teams.length} accepted teams`);

  return teams;
}

async function getStreamPosts(streamChannel) {
  const messages = await fetchAllMessages(streamChannel);

  return messages
    .filter(msg => {
      if (msg.author.bot) return false;

      const links = [
        ...msg.content.matchAll(TWITCH_REGEX)
      ];

      if (!links.length) return false;

      const isStaff =
        msg.member?.permissions?.has(
          PermissionFlagsBits.ManageRoles
        );

      return !(isStaff && links.length > 5);
    })
    .map(msg => ({
      authorId: msg.author.id,
      linkCount: [
        ...msg.content.matchAll(TWITCH_REGEX)
      ].length
    }));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("teamstreamcheck")
    .setDescription("Check team streams")
    .addStringOption(option =>
      option
        .setName("gamemode")
        .setDescription("Event mode")
        .setRequired(true)
        .addChoices(
          {
            name: "Duos/Trios",
            value: "smallteam"
          },
          {
            name: "Squads",
            value: "squads"
          }
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

      const channels = await interaction.guild.channels.fetch();

      const signupChannel = channels.find(c =>
        c.parentId === category?.id &&
        c.isTextBased?.() &&
        c.name.toLowerCase().includes("sign")
      );

      if (!signupChannel) {
        return interaction.reply({
          content: "Signup channel not found.",
          ephemeral: true
        });
      }

      await interaction.reply("Scanning...");

      const teams = await getTeams(signupChannel);
      const streamPosts = await getStreamPosts(baseChannel);

      const missing = [];

      for (const team of teams) {
        let total = 0;

        for (const post of streamPosts) {
          if (!team.members.includes(post.authorId)) {
            continue;
          }

          total += Math.min(post.linkCount, 2);

          if (total >= required) {
            break;
          }
        }

        console.log(
          `Team ${team.number}: ${total}/${required}`
        );

        if (total < required) {
          missing.push({
            number: team.number,
            count: total
          });
        }
      }

      let output = `📺 **Team Stream Check**\n\nRequired: ${required}\n\n`;

      if (missing.length) {
        for (const t of missing) {
          output += `Team ${t.number} (${t.count}/${required})\n`;
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
