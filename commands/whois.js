const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const { getEventBanRows } = require('../lib/eventBanSheet');
const { describeUserStatus } = require('../lib/eventBanRoles');

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
    let probationStatus = 'None';

    try {
      const rows = await getEventBanRows();
      const status = describeUserStatus(targetUser.id, rows);

      if (status.eventBan) {
        eventBanStatus =
          `${status.eventBan.type} (${status.eventBan.remaining} events remaining)`;
      } else if (status.offenses.length) {
        eventBanStatus =
          `No active ban (${status.offenses.length} offense log(s) on record)`;
      }

      if (status.probation) {
        probationStatus =
          `${status.probation.type} (${status.probation.remaining} days remaining)`;
      }
    } catch (err) {
      console.error('[WHOIS EVENT BAN ERROR]', err);
      eventBanStatus = 'Error reading sheet';
      probationStatus = 'Error reading sheet';
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
        { name: 'Event Ban Status', value: eventBanStatus },
        { name: 'Probation Status', value: probationStatus }
      );

    await interaction.editReply({ embeds: [embed] });
  }
};