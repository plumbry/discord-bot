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

async function getTeams(signupChannel) {
  const messages =
    await fetchAllMessages(signupChannel);

  const teams = [];

  for (const msg of messages) {
    if (msg.author.bot) continue;

    try {
      await msg.reactions.fetch();

      const acceptedReaction =
        msg.reactions.cache.find(
          r =>
            r.emoji.id ===
            ACCEPTED_EMOJI_ID
        );

      if (!acceptedReaction) continue;

      const members = [
        ...msg.mentions.users.keys()
      ];

      if (!members.length) continue;

      teams.push({
        number:
          teams.length + 1,
        members
      });

    } catch {}
  }

  return teams;
}

async function getTeamSubmissions(streamChannel) {
  const messages =
    await fetchAllMessages(streamChannel);

  const submissions =
    new Map();

  for (const msg of messages) {
    if (msg.author.bot) continue;

    const links = [
      ...msg.content.matchAll(
        TWITCH_REGEX
      )
    ];

    if (!links.length) continue;

    const isStaff =
      msg.member?.permissions?.has(
        PermissionFlagsBits.ManageRoles
      );

    if (
      isStaff &&
      links.length > 5
    ) {
      continue;
    }

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

    const userLinks =
      submissions.get(
        msg.author.id
      );

    for (const link of links) {
      userLinks.add(
        link[1].toLowerCase()
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
        "Check stream submissions"
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

      const category =
        interaction.channel.parent;

      const channels =
        await interaction.guild.channels.fetch();

      const signupChannel =
        channels.find(
          c =>
            c.parentId === category.id &&
            c.name
              .toLowerCase()
              .includes("sign")
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

      const submissions =
        await getTeamSubmissions(
          interaction.channel
        );

      const missingTeams=[];

      for (const team of teams) {

        const links =
          new Set();

        for (const member of team.members) {

          const submitted =
            submissions.get(
              member
            );

          if (!submitted)
            continue;

          submitted.forEach(
            link =>
            links.add(link)
          );
        }

        if (
          links.size <
          requiredStreams
        ) {

          missingTeams.push({
            number:
              team.number,
            count:
              links.size
          });

        }

      }

      let output =
`📺 **Team Stream Check**

Required: ${requiredStreams}

`;

      if (
        missingTeams.length
      ) {

        missingTeams.forEach(
          team=>{
            output+=
`Team ${team.number} (${team.count}/${requiredStreams})
`;
          }
        );

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