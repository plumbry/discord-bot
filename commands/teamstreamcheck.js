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

    let messages = [];
    let lastId;

    while (true) {
      const options = { limit: 100 };

      if (lastId) {
        options.before = lastId;
      }

      const batch =
        await channel.messages.fetch(options);

      if (!batch.size) break;

      messages.push(...batch.values());

      lastId = batch.last().id;
    }

    return messages.reverse();

  } catch (err) {
    console.error(err);
    return [];
  }
}

/**
 * Extract accepted teams
 */
async function getTeams(signupChannel) {
  const messages =
    await fetchAllMessages(signupChannel);

  const teams = [];

  for (const msg of messages) {
    if (msg.author.bot) continue;

    let accepted = false;

    for (const reaction of msg.reactions.cache.values()) {
      if (
        reaction.emoji.id ===
        ACCEPTED_EMOJI_ID
      ) {
        try {
          const users =
            await reaction.users.fetch();

          if (users.size > 0) {
            accepted = true;
            break;
          }

        } catch {}
      }
    }

    if (!accepted) continue;

    const members =
      msg.mentions.users.size
        ? [...msg.mentions.users.keys()]
        : [];

    if (members.length) {
      teams.push({
        number: teams.length + 1,
        members
      });
    }
  }

  return teams;
}

/**
 * Count unique Twitch links
 */
async function getSubmittedStreams(
  streamChannel
) {
  const messages =
    await fetchAllMessages(streamChannel);

  const streams = new Set();

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const matches = [
      ...msg.content.matchAll(
        TWITCH_REGEX
      )
    ];

    if (!matches.length) continue;

    const isStaff =
      msg.member?.permissions?.has(
        PermissionFlagsBits.ManageRoles
      );

    const batchMode =
      isStaff && matches.length > 5;

    if (batchMode) continue;

    for (const match of matches) {
      streams.add(
        match[1].toLowerCase()
      );
    }
  }

  return streams;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("teamstreamcheck")
    .setDescription(
      "Check which accepted teams have not submitted enough streams"
    )
    .addStringOption(option =>
      option
        .setName("gamemode")
        .setDescription(
          "Select event gamemode"
        )
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
        interaction.options.getString(
          "gamemode"
        );

      const requiredStreams =
        gamemode === "squads"
          ? 2
          : 1;

      const baseChannel =
        interaction.channel.isThread?.()
          ? interaction.channel.parent
          : interaction.channel;

      const category =
        baseChannel?.parent;

      if (!category) {
        return interaction.reply({
          content:
            "This command must be used inside an event category.",
          ephemeral: true
        });
      }

      const fetched =
        await interaction.guild.channels.fetch();

      const signupChannel =
        fetched.find(c => {
          if (
            c.parentId !== category.id
          ) return false;

          if (
            !c.isTextBased()
          ) return false;

          const name =
            c.name.toLowerCase();

          return (
            name.includes("sign") &&
            !name.includes("solo") &&
            !name.includes("lfg") &&
            !name.includes(
              "free-agent"
            )
          );
        });

      if (!signupChannel) {
        return interaction.reply({
          content:
            "No signup channel found.",
          ephemeral: true
        });
      }

      const streamChannel =
        interaction.channel.isThread?.()
          ? interaction.channel.parent
          : interaction.channel;

      await interaction.reply(
        `Scanning accepted teams (${requiredStreams} stream(s) required)...`
      );

      const teams =
        await getTeams(
          signupChannel
        );

      const streams =
        await getSubmittedStreams(
          streamChannel
        );

      const missingTeams = [];

      for (const team of teams) {
        const count =
          Math.min(
            streams.size,
            requiredStreams
          );

        if (
          count <
          requiredStreams
        ) {
          missingTeams.push({
            number:
              team.number,
            count
          });
        }
      }

      let message =
        `📺 **Team Stream Check**\n\n`;

      if (
        missingTeams.length
      ) {
        message +=
          `Missing (${missingTeams.length})\n\n`;

        for (const team of missingTeams) {
          message +=
            `Team ${team.number} (${team.count}/${requiredStreams})\n`;
        }
      } else {
        message +=
          `All accepted teams submitted enough streams.`;
      }

      await interaction.followUp(
        message
      );

    } catch (error) {
      console.error(
        "❌ teamstreamcheck:",
        error
      );
    }
  }
};