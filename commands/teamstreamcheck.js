const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const TWITCH_REGEX = /twitch\.tv\/([a-zA-Z0-9_]+)/gi;
const ACCEPTED_EMOJI_ID = "1405510864496361482";

async function fetchAllMessages(channel) {
  try {
    if (!channel?.viewable) return [];

    const perms = channel.permissionsFor(
      channel.client.user
    );

    if (
      !perms?.has(PermissionFlagsBits.ViewChannel) ||
      !perms?.has(PermissionFlagsBits.ReadMessageHistory)
    ) {
      return [];
    }

    let messages = [];
    let lastId;

    while (true) {
      const batch =
        await channel.messages.fetch({
          limit: 100,
          before: lastId
        });

      if (!batch.size) break;

      messages.push(...batch.values());
      lastId = batch.last().id;
    }

    return messages.reverse();

  } catch (err) {
    console.error(
      "fetchAllMessages:",
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

    try {

      await msg.reactions.fetch();

      const accepted =
        msg.reactions.cache.some(
          r =>
            r.emoji.id ===
            ACCEPTED_EMOJI_ID
        );

      if (!accepted) continue;

      // signup creator + USER mentions only
      const members = [
        msg.author.id,
        ...msg.mentions.users.map(
          u => u.id
        )
      ];

      const uniqueMembers =
        [...new Set(members)];

      teams.push({
        number:
          teams.length + 1,
        members:
          uniqueMembers
      });

    } catch(err) {
      console.log(
        "Team parse failed",
        msg.id
      );
    }
  }

  return teams;
}

async function getStreamPosts(
  streamChannel
) {

  const messages =
    await fetchAllMessages(
      streamChannel
    );

  return messages
    .filter(msg => {

      if (msg.author.bot)
        return false;

      const links =
        [
          ...msg.content.matchAll(
            TWITCH_REGEX
          )
        ];

      if (!links.length)
        return false;

      const isStaff =
        msg.member?.permissions?.has(
          PermissionFlagsBits.ManageRoles
        );

      return !(
        isStaff &&
        links.length > 5
      );

    })
    .map(msg => ({
      authorId:
        msg.author.id,

      linkCount:
        [...msg.content.matchAll(
          TWITCH_REGEX
        )].length
    }));
}

module.exports = {

  data:
    new SlashCommandBuilder()
      .setName(
        "teamstreamcheck"
      )
      .setDescription(
        "Check team streams"
      )
      .addStringOption(
        option =>
          option
            .setName(
              "gamemode"
            )
            .setDescription(
              "Event mode"
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
        PermissionFlagsBits
          .ModerateMembers
      ),

  async execute(
    interaction
  ) {

    try {

      const required =
        interaction.options.getString(
          "gamemode"
        ) === "squads"
          ? 2
          : 1;

      const category =
        interaction.channel.parent;

      const channels =
        await interaction.guild.channels.fetch();

      const signupChannel =
        channels.find(c =>
          c.parentId ===
            category.id &&
          c.name
            .toLowerCase()
            .includes(
              "sign"
            )
        );

      if (!signupChannel) {

        return interaction.reply({
          content:
            "Signup channel not found.",
          ephemeral:true
        });

      }

      await interaction.reply(
        "Scanning..."
      );

      const teams =
        await getTeams(
          signupChannel
        );

      const streamPosts =
        await getStreamPosts(
          interaction.channel
        );

      const missing=[];

      for (const team of teams) {

        let total=0;

        for (const post of streamPosts) {

          if (
            !team.members.includes(
              post.authorId
            )
          ) continue;

          total += Math.min(
            post.linkCount,
            2
          );

          if (
            total >= required
          ) break;
        }

        if (
          total < required
        ) {

          missing.push({
            number:
              team.number,
            count:
              total
          });

        }
      }

      let output =
`📺 **Team Stream Check**

Required: ${required}

`;

      if (missing.length) {

        for (const t of missing) {

          output +=
`Team ${t.number} (${t.count}/${required})
`;

        }

      } else {

        output +=
"All accepted teams submitted enough streams.";

      }

      await interaction.followUp(
        output
      );

    } catch(err){

      console.error(err);

    }

  }
};