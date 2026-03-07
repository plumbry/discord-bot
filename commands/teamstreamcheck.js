const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

// ================= FETCH ALL MESSAGES =================
async function fetchAllMessages(channel) {

  let messages = [];
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
}

// ================= GET TEAMS =================
async function getTeams(signupChannel) {

  const messages = await fetchAllMessages(signupChannel);
  const teams = [];

  for (const msg of messages) {

    if (msg.author.bot) continue;

    const accepted = msg.reactions.cache.some(
      r => r.emoji.name === "ZBDACCEPTED"
    );

    if (!accepted) continue;

    const members = [...msg.mentions.users.values()].map(u => u.id);

    if (members.length >= 1) {

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
    .setDescription("Check which accepted teams have not submitted a stream")
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
      c => {
        if (!c.isTextBased()) return false;
        const name = c.name.toLowerCase();
        return name.includes("sign-ups") || name.includes("signups");
      }
    );

    if (!signupChannel) {

      return interaction.reply({
        content: "Could not find a sign-ups channel in this category.",
        ephemeral: true
      });

    }

    await interaction.reply("Scanning accepted teams and stream submissions...");

    const teams = await getTeams(signupChannel);
    const posters = await getStreamPosters(interaction.channel);

    const missingTeams = [];

    teams.forEach(team => {

      const hasStream = team.members.some(member => posters.has(member));

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

      message += `All accepted teams have at least one stream submitted.`;

    }

    await interaction.followUp(message);

  }

};