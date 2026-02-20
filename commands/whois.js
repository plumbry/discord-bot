const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const { google } = require('googleapis');

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

/**
 * Tier role detection (S / A / B / C)
 * Assumes roles already exist — detect only
 */
function detectTierRole(member) {
  const tierNames = ['S', 'A', 'B', 'C'];
  const tierRole = member.roles.cache.find(r => tierNames.includes(r.name));
  return tierRole ? tierRole.name : 'None';
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

    // Tier role
    const tier = detectTierRole(member);

    // Event ban lookup
    let eventBanStatus = 'None';

    try {
      const sheets = getSheetsClient();

      const spreadsheetId = process.env.EVENT_BANS_SHEET_ID;
      const range = 'A2:J';

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range
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
      eventBanStatus = 'Error reading sheet';
    }

    const embed = new EmbedBuilder()
      .setTitle('User Information')
      .setColor(0x5865F2)
      .setThumbnail(targetUser.displayAvatarURL())
      .addFields(
        {
          name: 'User',
          value: `${targetUser.tag}`,
          inline: false
        },
        {
          name: 'User ID',
          value: targetUser.id,
          inline: false
        },
        {
          name: 'Account Created',
          value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:F>`,
          inline: false
        },
        {
          name: 'Joined Server',
          value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`,
          inline: false
        },
        {
          name: 'Roles',
          value: roles,
          inline: false
        },
        {
          name: 'Tier',
          value: tier,
          inline: true
        },
        {
          name: 'Event Ban Status',
          value: eventBanStatus,
          inline: true
        }
      );

    await interaction.editReply({ embeds: [embed] });
  }
};