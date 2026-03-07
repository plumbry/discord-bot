const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

async function fetchAllMessages(channel) {
  let messages = [];
  let lastId;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options);
    if (batch.size === 0) break;

    messages.push(...batch.values());
    lastId = batch.last().id;
  }

  return messages.reverse();
}

// ================= GET TEAMS =================
async function getTeams(signupChannel) {

  const messages = await fetchAllMessages(signupChannel);
  const teams = [];

  for (const msg of messages) {

    if (msg.author.bot) continue;

    const members = [...msg.mentions.users.values()].map(u => u.id);

    if (members.length >= 2) {

      teams.push({
        number: teams.length + 1,
        members
      });

    }

  }

  return teams;
}

// ================= GET STREAM POSTERS =================
async function getStreamPosters(streamChannel) {

  const messages = await fetchAllMessages(streamChannel);
  const posters = new Set();

  for (const msg of messages) {

    if (msg.author.bot) continue;

    if (msg.content.toLowerCase().includes("twitch.tv")) {
      posters.add(msg.author.id);
    }

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
    const debug = [];

    for (const team of teams) {

      const hasStream = team.members.some(id => posters.has(id));

      debug.push(`Team ${team.number} members: ${team.members.join(", ")}`);

      if (!hasStream) {
        missingTeams.push(team.number);
      }

    }

    console.log("Team Debug:");
    console.log(debug.join("\n"));
    console.log("Stream Posters:", [...posters]);

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