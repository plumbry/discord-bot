const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('tierinactive')
    .setDescription('List Tier players with zero messages (joined >6 months)'),

  async execute(interaction) {

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;

    const sixMonthsAgo = Date.now() - (1000 * 60 * 60 * 24 * 30 * 6);

    const members = await guild.members.fetch();

    const inactive = [];

    for (const member of members.values()) {

      if (member.user.bot) continue;

      const hasTier = member.roles.cache.some(r => r.name.includes("Tier"));
      if (!hasTier) continue;

      if (!member.joinedTimestamp || member.joinedTimestamp > sixMonthsAgo) continue;

      const row = db.prepare(
        "SELECT count FROM messages WHERE userId = ?"
      ).get(member.id);

      const messageCount = row ? row.count : 0;

      if (messageCount === 0) {
        inactive.push(member.user.tag);
      }

    }

    if (inactive.length === 0) {
      return interaction.editReply("No inactive Tier players found.");
    }

    const list = inactive.slice(0, 50).join("\n");

    interaction.editReply(
      `**Tier players with 0 messages (joined >6 months):**\n\n${list}\n\nTotal: ${inactive.length}`
    );

  }
};