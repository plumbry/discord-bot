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

    let messages = [];
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
          reaction =>
            reaction.emoji.id === ACCEPTED_EMOJI_ID
        );

      if (!acceptedReaction?.count) continue;

      // Include signup author + tagged teammates
      const members = [
        msg.author.id,
        ...msg.mentions.users.keys()
      ];

      const uniqueMembers = [
        ...new Set(members)
      ];

      if (!uniqueMembers.length) continue;

      teams.push({
        number: teams.length + 1,
        members: uniqueMembers
      });

    } catch (err) {
      console.log(
        `⚠️ Team parse failed: ${msg.id}`
      );
    }
  }

  console.log(`✅ Teams found: ${teams.length}`);

  return teams;
}

async function getTeamSubmissions(streamChannel) {
  const messages = await fetchAllMessages(streamChannel);

  const submissions = new Map();

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const links = [
      ...msg.content.matchAll(TWITCH_REGEX)
    ];

    if (!links.length) continue;

    const isStaff =
      msg.member?.permissions?.has(
        PermissionFlagsBits.ManageRoles
      );

    const batchMode =
      isStaff && links.length > 5;

    // Ignore mass reposts by staff
    if (batchMode) continue;

    if (!submissions.has(msg.author.id)) {
      submissions.set(msg.author.id, new Set());
    }

    const userLinks =
      submissions.get(msg.author.id);

    for (const link of links) {
      userLinks.add(
        link[1].toLowerCase()
      );
    }
  }

  return submissions;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("teamstreamcheck")
    .setDescription("Check which accepted teams are missing streams")
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
          content: "Must be run in an event category.",
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

      const submissions =
        await getTeamSubmissions(baseChannel);

      const missingTeams = [];

      for (const team of teams) {
        const teamLinks = new Set();

        for (const memberId of team.members) {
          const memberLinks =
            submissions.get(memberId);

          if (!memberLinks) continue;

          for (const link of memberLinks) {
            teamLinks.add(link);
          }
        }

        if (teamLinks.size < requiredStreams) {
          missingTeams.push({
            number: team.number,
            count: teamLinks.size
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
          output +=
            `Team ${team.number} (${team.count}/${requiredStreams})\n`;
        }
      } else {
        output +=
          "All accepted teams submitted enough streams.";
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