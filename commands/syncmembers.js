const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const fetch = require('node-fetch');

const API_URL = 'https://healthy-husky-184.convex.site/api/discord/sync-member';
const API_KEY = 'sk_hercules_DwjowtgAYninKRto818PrAb5YJTzhuXGWkmPVmigxMZg4BEU6a';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('syncmembers')
    .setDescription('Sync all Discord members to Hercules')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    await interaction.reply({
      content: 'Starting member sync...',
      ephemeral: true
    });

    try {
      const guild = interaction.guild;

      await guild.members.fetch();

      let successCount = 0;
      let errorCount = 0;

      for (const [memberId, member] of guild.members.cache) {
        if (member.user.bot) continue;

        const roles = member.roles.cache
          .filter(role => role.name !== '@everyone')
          .map(role => ({
            id: role.id,
            name: role.name
          }));

        const payload = {
          id: member.user.id,
          username: member.user.username,
          nickname: member.nickname || null,
          joined_at: member.joinedAt
            ? member.joinedAt.toISOString()
            : new Date().toISOString(),
          roles: roles.length > 0 ? roles : null
        };

        try {
          const res = await fetch(API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${API_KEY}`
            },
            body: JSON.stringify(payload)
          });

          if (res.ok) {
            successCount++;
            console.log(`✓ Synced ${member.user.username}`);
          } else {
            errorCount++;

            const text = await res.text();

            console.error(
              `✗ Failed ${member.user.username}:`,
              res.status,
              text
            );
          }
        } catch (err) {
          errorCount++;

          console.error(
            `✗ Error syncing ${member.user.username}:`,
            err
          );
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      await interaction.editReply({
        content:
          `✅ Sync complete\n\n` +
          `✓ Success: ${successCount}\n` +
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