const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const { google } = require('googleapis');

// ⬇️ IMPORT EVENT BAN SHEET SOURCE OF TRUTH
const { EVENT_BANS_SHEET_ID } = require('../event bans/eventBans');

/**
 * Google Sheets auth helper
 */
function getSheetsClient() {
  const credentials = JSON.parse(
    Buffer.from(
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
      'base64'
    ).toString('utf8')
  );

  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );

  return google.sheets({ version: 'v4', auth });
}

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
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('user');
    const guild = interaction.guild;

    const member = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      return interaction.editReply({
        content: 'User is not in this server.'
      });
    }

    // Roles (excluding @everyone)
    const roles = member.roles.cache
      .filter(r => r.id !== guild.id)
      .map(r => r.name)
      .join(', ') || 'None';

    // Event ban lookup
    let eventBanStatus = 'None';

    try {
      const sheets = getSheetsClient();

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: EVENT_BANS_SHEET_ID,
        range: 'A2:J'
      });

      const rows = res.data.values || [];

      const activeBan = rows.find(row => {
        const discordId = row[0];
        const remainingEvents = Number(row[4]);
        return discordId === targetUser.id && remainingEvents > 0;
      });

      if (activeBan) {
        const banType = activeBan[2] || 'Unknown';
        const remaining = activeBan[4] || '0';
        eventBanStatus = `${banType} (${remaining} events remaining)`;
      }
    } catch (err) {
      console.error('[WHOIS EVENT BAN ERROR]', err.message);
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