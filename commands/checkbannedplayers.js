const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const EVENT_BAN_ROLE = "1463660686231207956";

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

module.exports = {

  data: new SlashCommandBuilder()
    .setName("checkbannedplayers")
    .setDescription("Check if signed up players have the Event Ban role")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {

    await interaction.reply("Scanning signups for banned players...");

    const messages = await fetchAllMessages(interaction.channel);

    const bannedTeams = [];
    let teamNumber = 1;

    for (const msg of messages) {

      if (msg.author.bot) continue;

      const accepted = msg.reactions.cache.some(
        r => r.emoji.name === "ZBDACCEPTED"
      );

      if (!accepted) continue;

      const members = [...msg.mentions.users.values()];

      const bannedPlayers = [];

      for (const user of members) {

        const member = await interaction.guild.members.fetch(user.id);

        if (member.roles.cache.has(EVENT_BAN_ROLE)) {
          bannedPlayers.push(member.user.tag);
        }

      }

      if (bannedPlayers.length) {

        bannedTeams.push({
          team: teamNumber,
          players: bannedPlayers
        });

      }

      teamNumber++;

    }

    if (!bannedTeams.length) {

      return interaction.followUp(
        "✅ No signed up players currently have the Event Ban role."
      );

    }

    let message = "🚫 Players With Event Ban Role\n\n";

    for (const team of bannedTeams) {

      message += `Team ${team.team}\n`;

      for (const player of team.players) {
        message += `${player}\n`;
      }

      message += "\n";

    }

    await interaction.followUp(message);

  }

};