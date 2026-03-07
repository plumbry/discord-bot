const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const TWITCH_REGEX = /twitch\.tv\/([a-zA-Z0-9_]+)(?:\/|$)/gi;

async function getTeams(signupChannel) {

  let lastId;
  const messages = [];

  while (true) {

    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await signupChannel.messages.fetch(options);
    if (!batch.size) break;

    messages.push(...batch.values());
    lastId = batch.last().id;

  }

  // oldest message first so team numbers match signup order
  messages.reverse();

  const teams = [];

  messages.forEach(msg => {

    const users = [...msg.mentions.users.values()].map(u => u.id);

    if (users.length) {

      teams.push({
        number: teams.length + 1,
        members: users
      });

    }

  });

  return teams;

}

async function getStreamPosters(streamChannel) {

  let lastId;
  const posters = new Set();

  while (true) {

    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const messages = await streamChannel.messages.fetch(options);
    if (!messages.size) break;

    messages.forEach(msg => {

      if (TWITCH_REGEX.test(msg.content)) {
        posters.add(msg.author.id);
      }

    });

    lastId = messages.last().id;

  }

  return posters;

}

module.exports = {

  data: new SlashCommandBuilder()
    .setName("teamstreamcheck")
    .setDescription("Check which teams have not submitted a stream")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {

    const category = interaction.channel.parent;

    if (!category) {

      return interaction.reply({
        content: "This command must be used inside an event category.",
        ephemeral: true
      });

    }

    // find sign-ups channel automatically
    const signupChannel = category.children.cache.find(
      c =>
        c.isTextBased() &&
        c.name.toLowerCase().includes("sign-ups")
    );

    if (!signupChannel) {

      return interaction.reply({
        content: "Could not find a sign-ups channel in this category.",
        ephemeral: true
      });

    }

    await interaction.reply("Checking teams for stream submissions...");

    const teams = await getTeams(signupChannel);
    const posters = await getStreamPosters(interaction.channel);

    const missingTeams = [];

    teams.forEach(team => {

      const hasStream = team.members.some(id => posters.has(id));

      if (!hasStream) {
        missingTeams.push(team.number);
      }

    });

    let message = `📺 **Team Stream Check**\n\n`;

    if (missingTeams.length) {

      message += `Teams Missing Stream (${missingTeams.length})\n\n`;

      missingTeams.forEach(num => {
        message += `Team ${num}\n`;
      });

    } else {

      message += `All teams have at least one stream submitted.`;

    }

    await interaction.followUp(message);

  }

};