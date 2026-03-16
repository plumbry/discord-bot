const { SlashCommandBuilder } = require("discord.js");
const Database = require("better-sqlite3");

// ================= DATABASE =================

const db = new Database("./activity.db");

// ================= COMMAND =================

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tierinactive")
    .setDescription("List Tier players with zero messages who joined over 6 months ago"),

  async execute(interaction) {

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;

    const sixMonthsAgo = Date.now() - (1000 * 60 * 60 * 24 * 30 * 6);

    const members = await guild.members.fetch();

    const inactive = [];

    for (const member of members.values()) {

      if (member.user.bot) continue;

      const hasTier = member.roles.cache.some(role =>
        role.name.toLowerCase().includes("tier")
      );

      if (!hasTier) continue;

      if (!member.joinedTimestamp || member.joinedTimestamp > sixMonthsAgo)
        continue;

      const row = db
        .prepare("SELECT count FROM messages WHERE userId = ?")
        .get(member.id);

      const messageCount = row ? row.count : 0;

      if (messageCount === 0) {
        inactive.push(`${member.user.tag}`);
      }

    }

    if (inactive.length === 0) {

      return interaction.editReply(
        "✅ No Tier players with 0 messages found who joined over 6 months ago."
      );

    }

    const list = inactive.slice(0, 50).join("\n");

    await interaction.editReply(
      `**Tier players with 0 messages (joined >6 months):**\n\n${list}\n\nTotal: ${inactive.length}`
    );

  }
};