const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const { getSheets } = require('../lib/sheets');

// ================= CONSTANT =================
const EVENT_BANS_SHEET_ID = process.env.MAIN_SHEET_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('whois')
    .setDescription('View moderation-relevant info about a user')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to inspect')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {

    if (!process.env.MAIN_SHEET_ID) {
      return interaction.editReply({
        content: '❌ MAIN_SHEET_ID is not configured.'
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user');
    const guild = interaction.guild;

    const member = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      return interaction.editReply({
        content: 'User is not in this server.'
      });
    }

    const roles = member.roles.cache
      .filter(r => r.id !== guild.id)
      .map(r => r.name)
      .join(', ') || 'None';

    let eventBanStatus = 'None';

    try {
      const res = await getSheets().spreadsheets.values.get({
        spreadsheetId: EVENT_BANS_SHEET_ID,
        range: 'Event Bans!A2:K'
      });

      const rows = res.data.values || [];

      const activeBan = rows.find(row => {
        const discordId = row[0];
        const remainingEvents = Number(row[4]);
        const type = row[2];
        return (
          discordId === targetUser.id &&
          type !== 'Probation' &&
          remainingEvents > 0
        );
      });

      if (activeBan) {
        const banType = activeBan[2] || 'Unknown';
        const remaining = activeBan[4] || '0';
        eventBanStatus = `${banType} (${remaining} events remaining)`;
      }
    } catch (err) {
      console.error('[WHOIS EVENT BAN ERROR]', err);
      eventBanStatus = 'Error reading sheet';
    }

    const embed = new EmbedBuilder()
      .setTitle('User Information')
      .setColor(0x5865F2)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        { name: 'User', value: targetUser.tag },
        { name: 'User ID', value: targetUser.id },
        {
          name: 'Account Created',
          value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:F>`
        },
        {
          name: 'Joined Server',
          value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
        },
        { name: 'Roles', value: roles },
        { name: 'Event Ban Status', value: eventBanStatus }
      );

    await interaction.editReply({ embeds: [embed] });
  }
};