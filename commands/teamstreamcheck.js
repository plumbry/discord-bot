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
      lastId = batch.last().id;
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
          reaction => reaction.emoji.id === ACCEPTED_EMOJI_ID
        );

      if (!acceptedReaction?.count) continue;

      // signup author + tagged members
      const members = [
        msg.author.id,
        ...msg.mentions.users.keys()
      ];

      const uniqueMembers = [...new Set(members)];

      teams.push({
        number: teams.length + 1,
        members: uniqueMembers
      });

    } catch (err) {
      console.log(`⚠️ Failed team parse ${msg.id}`);
    }
  }

  return teams;
}

async function getStreamMessages(streamChannel) {
  const messages = await fetchAllMessages(streamChannel);

  return messages.filter(msg => {
    if (msg.author.bot) return false;

    const links = [
      ...msg.content.matchAll(TWITCH_REGEX)
    ];

    if (!links.length) return false;

    const isStaff =
      msg.member?.permissions?.has(
        PermissionFlagsBits.ManageRoles
      );

    const batchMode =
      isStaff && links.length > 5;

    return !batchMode;
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("teamstreamcheck")
    .setDescription(
      "Check accepted teams for missing streams"
    )
    .addStringOption(option =>
      option
        .setName("gamemode")
        .setDescription("Select event gamemode")
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
      const gamemode =
        interaction.options.getString("gamemode");

      const requiredStreams =
        gamemode === "squads"
          ? 2
          : 1;

      const baseChannel =
        interaction.channel.isThread?.()
          ? interaction.channel.parent
          : interaction.channel;

      const category = baseChannel?.parent;

      if (!category) {
        return interaction.reply({
          content: "Must be used in an event category.",
          ephemeral: true
        });
      }

      const channels =
        await interaction.guild.channels.fetch();

      const signupChannel = channels.find(c => {
        if (c.parentId !== category.id) return false;
        if (!c.isTextBased()) return false;

        const name = c.name.toLowerCase();

        return (
          name.includes("sign") &&
          !name.includes("solo") &&
          !name.includes("lfg") &&
          !name.includes("free-agent")
        );
      });

      if (!signupChannel) {
        return interaction.reply({
          content: "No signup channel found.",
          ephemeral: true
        });
      }

      await interaction.reply(
        `Scanning accepted teams (${requiredStreams} required)...`
      );

      const teams =
        await getTeams(signupChannel);

      const streamMessages =
        await getStreamMessages(baseChannel);

      const missingTeams = [];

      for (const team of teams) {
        let totalLinks = 0;

        for (const msg of streamMessages) {
          if (!team.members.includes(msg.author.id)) {
            continue;
          }

          const links = [
            ...msg.content.matchAll(TWITCH_REGEX)
          ];

          totalLinks += links.length;
        }

        if (totalLinks < requiredStreams) {
          missingTeams.push({
            number: team.number,
            count: totalLinks
          });
        }
      }

      let output =
`📺 **Team Stream Check**

Gamemode: ${gamemode === "squads" ? "Squads" : "Duos/Trios"}
Required Streams: ${requiredStreams}

`;

      if (missingTeams.length) {
        output += `Teams Missing Streams (${missingTeams.length})\n\n`;

        for (const team of missingTeams) {
          output += `Team ${team.number} (${team.count}/${requiredStreams})\n`;
        }
      } else {
        output += "All accepted teams submitted enough streams.";
      }

      await interaction.followUp(output);

    } catch (err) {
      console.error("❌ teamstreamcheck:", err);

      if (!interaction.replied) {
        await interaction.reply({
          content: "Something went wrong.",
          ephemeral: true
        });
      }
    }
  }
};