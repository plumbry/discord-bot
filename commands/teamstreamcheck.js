const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const TWITCH_REGEX = /twitch\.tv/i;

// ================= GET TEAMS =================
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

  messages.reverse();

  const teams = [];

  messages.forEach(msg => {

    const users = [...msg.mentions.users.values()];

    if (users.length === 2) {

      teams.push({
        number: teams.length + 1,
        members: users.map(u => u.id)
      });

    }

  });

  return teams;

}

// ================= GET STREAM POSTERS =================
async function getStreamMessages(streamChannel) {

  let lastId;
  const messages = [];

  while (true) {

    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await streamChannel.messages.fetch(options);
    if (!batch.size) break;

    batch.forEach(msg => {

      if (TWITCH_REGEX.test(msg.content)) {
        messages.push(msg);
      }

    });

    lastId = batch.last().id;

  }

  return messages;

}

// ================= COMMAND =================
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

    const signupChannel = category.children.cache.find(
      c => c.isTextBased() && c.name.toLowerCase().includes("sign-ups")
    );

    if (!signupChannel) {
      return interaction.reply({
        content: "Could not find a sign-ups channel in this category.",
        ephemeral: true
      });
    }

    await interaction.reply("Scanning teams and stream submissions...");

    const teams = await getTeams(signupChannel);
    const streamMessages = await getStreamMessages(interaction.channel);

    const missingTeams = [];

    teams.forEach(team => {

      const hasStream = streamMessages.some(msg =>
        team.members.includes(msg.author.id)
      );

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