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

    const perms = channel.permissionsFor(
      channel.client.user
    );

    if (
      !perms?.has(
        PermissionFlagsBits.ViewChannel
      ) ||
      !perms?.has(
        PermissionFlagsBits.ReadMessageHistory
      )
    ) {
      return [];
    }

    const messages = [];
    let lastId = null;

    while (true) {
      const options = { limit: 100 };

      if (lastId) {
        options.before = lastId;
      }

      const batch =
        await channel.messages.fetch(
          options
        );

      if (!batch.size) break;

      messages.push(
        ...batch.values()
      );

      lastId =
        batch.last()?.id;
    }

    return messages.reverse();

  } catch (err) {
    console.error(
      "❌ fetchAllMessages:",
      err
    );

    return [];
  }
}

async function getTeams(signupChannel) {
  const messages =
    await fetchAllMessages(
      signupChannel
    );

  const teams = [];

  for (const msg of messages) {
    if (msg.author.bot) continue;

    let accepted = false;

    try {
      await msg.reactions.fetch();

      const acceptedReaction =
        msg.reactions.cache.find(
          reaction =>
            reaction.emoji.id ===
            ACCEPTED_EMOJI_ID
        );

      accepted =
        acceptedReaction?.count > 0;

    } catch {
      continue;
    }

    if (!accepted) continue;

    const members = [
      ...msg.mentions.users.keys()
    ];

    if (!members.length) continue;

    teams.push({
      number:
        teams.length + 1,
      members
    });
  }

  return teams;
}

async function getSubmittedStreams(
  streamChannel
) {
  const messages =
    await fetchAllMessages(
      streamChannel
    );

  const submissions =
    new Map();

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const matches = [
      ...msg.content.matchAll(
        TWITCH_REGEX
      )
    ];

    if (!matches.length)
      continue;

    const isStaff =
      msg.member?.permissions?.has(
        PermissionFlagsBits.ManageRoles
      );

    const batchMode =
      isStaff &&
      matches.length > 5;

    if (batchMode) continue;

    if (
      !submissions.has(
        msg.author.id
      )
    ) {
      submissions.set(
        msg.author.id,
        new Set()
      );
    }

    const userStreams =
      submissions.get(
        msg.author.id
      );

    for (const match of matches) {
      userStreams.add(
        match[1].toLowerCase()
      );
    }
  }

  return submissions;
}

module.exports = {
  data:
    new SlashCommandBuilder()
      .setName(
        "teamstreamcheck"
      )
      .setDescription(
        "Check missing team streams"
      )
      .addStringOption(
        option =>
          option
            .setName(
              "gamemode"
            )
            .setDescription(
              "Select gamemode"
            )
            .setRequired(
              true
            )
            .addChoices(
              {
                name:
                  "Duos/Trios",
                value:
                  "smallteam"
              },
              {
                name:
                  "Squads",
                value:
                  "squads"
              }
            )
      )
      .setDefaultMemberPermissions(
        PermissionFlagsBits.ModerateMembers
      ),

  async execute(
    interaction
  ) {
    try {
      const gamemode =
        interaction.options.getString(
          "gamemode"
        );

      const requiredStreams =
        gamemode ===
        "squads"
          ? 2
          : 1;

      const baseChannel =
        interaction.channel
          .isThread?.()
          ? interaction.channel
              .parent
          : interaction.channel;

      const category =
        baseChannel?.parent;

      if (!category) {
        return interaction.reply(
          {
            content:
              "Must be run inside event category.",
            ephemeral: true
          }
        );
      }

      const channels =
        await interaction.guild.channels.fetch();

      const signupChannel =
        channels.find(
          c =>
            c.parentId ===
              category.id &&
            c.isTextBased?.() &&
            c.name
              .toLowerCase()
              .includes(
                "sign"
              )
        );

      if (!signupChannel) {
        return interaction.reply(
          {
            content:
              "No signup channel found.",
            ephemeral: true
          }
        );
      }

      await interaction.reply(
        "Scanning teams..."
      );

      const teams =
        await getTeams(
          signupChannel
        );

      const submissions =
        await getSubmittedStreams(
          baseChannel
        );

      const missingTeams =
        [];

      for (const team of teams) {
        const teamStreams =
          new Set();

        for (const memberId of team.members) {
          const streams =
            submissions.get(
              memberId
            );

          if (!streams)
            continue;

          for (const stream of streams) {
            teamStreams.add(
              stream
            );
          }
        }

        if (
          teamStreams.size <
          requiredStreams
        ) {
          missingTeams.push({
            number:
              team.number,
            count:
              teamStreams.size
          });
        }
      }

      let output =
        `📺 **Team Stream Check**\n\n`;

      if (
        missingTeams.length
      ) {
        for (const team of missingTeams) {
          output +=
            `Team ${team.number} (${team.count}/${requiredStreams})\n`;
        }
      } else {
        output +=
          "All accepted teams submitted enough streams.";
      }

      await interaction.followUp(
        output
      );

    } catch (err) {
      console.error(
        "❌ teamstreamcheck:",
        err
      );
    }
  }
};