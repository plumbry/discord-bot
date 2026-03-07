const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

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

    const members = [...msg.mentions.users.values()].map(u => u.id);

    if (members.length >= 1) {

      teams.push({
        number: teams.length + 1,
        members
      });

    }

  });

  return teams;

}

// ================= GET STREAM POSTERS =================
async function getStreamPosters(streamChannel) {

  let lastId;
  const posters = new Set();

  while (true) {

    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await streamChannel.messages.fetch(options);
    if (!batch.size) break;

    batch.forEach(msg => {

      if (msg.content.toLowerCase().includes("twitch.tv")) {

        posters.add(msg.author.id);

      }

    });

    lastId = batch.last().id;

  }

  return posters;

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
        content: "Command must be used inside an event category.",
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