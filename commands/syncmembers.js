const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const {
  hasMemberSyncApiKey,
  syncAllGuildMembers
} = require('../lib/memberSyncApi');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('syncmembers')
    .setDescription('Sync all Discord members to coedzbd.com')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageRoles
    ),

  async execute(interaction) {
    if (!hasMemberSyncApiKey()) {
      return interaction.reply({
        content:
          '❌ Member sync API key is missing. Set DISCORD_SYNC_API_KEY.',
        ephemeral: true
      });
    }

    await interaction.reply({
      content: 'Starting member sync...',
      ephemeral: true
    });

    try {
      const guild = interaction.guild;
      const { successCount, errorCount, skippedCount } =
        await syncAllGuildMembers(guild);

      await interaction.editReply({
        content:
          `✅ Sync complete\n\n` +
          `✓ Success: ${successCount}\n` +
          `⊘ Skipped: ${skippedCount}\n` +
          `✗ Errors: ${errorCount}`
      });

    } catch (err) {
      console.error(err);

      await interaction.editReply({
        content: '❌ Sync failed.'
      });
    }
  }
};