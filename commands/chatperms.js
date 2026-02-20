const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const { google } = require('googleapis');

// ================= CONSTANTS =================
const LOG_CHANNEL_ID = '1471082166535454780';
const AUDIT_SHEET_ID = '1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM';
const AUDIT_RANGE = 'Audit Log!A:G';

// ================= GOOGLE SHEETS =================
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
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  return google.sheets({ version: 'v4', auth });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chatperms')
    .setDescription('Manage channel send-message permissions for a user')
    .addSubcommand(sub =>
      sub
        .setName('toggle')
        .setDescription('Toggle send message permissions for a user in this channel')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User to toggle chat permissions for')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('undo')
        .setDescription('Remove the user-specific permission overwrite in this channel')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User to remove channel overwrite for')
            .setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user');
    const channel = interaction.channel;
    const guild = interaction.guild;

    const member = await guild.members.fetch(targetUser.id).catch(() => null);

    if (!member) {
      return interaction.reply({
        content: 'User is not in this server.',
        ephemeral: true
      });
    }

    // ❌ Block mods/admins
    if (
      member.permissions.has(PermissionFlagsBits.ManageRoles) ||
      member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: 'You cannot use this command on moderators or administrators.',
        ephemeral: true
      });
    }

    let action;
    let message;

    // ================= TOGGLE =================
    if (subcommand === 'toggle') {
      const overwrite = channel.permissionOverwrites.cache.get(member.id);
      const currentlyDenied = overwrite?.deny?.has(PermissionFlagsBits.SendMessages);

      const disabling = !currentlyDenied;

      await channel.permissionOverwrites.edit(member, {
        SendMessages: disabling ? false : null
      });

      action = disabling ? 'CHAT_DISABLED' : 'CHAT_ENABLED';
      message = disabling
        ? `🔒 Chat disabled for ${member} in ${channel}`
        : `🔓 Chat enabled for ${member} in ${channel}`;
    }

    // ================= UNDO =================
    if (subcommand === 'undo') {
      const overwrite = channel.permissionOverwrites.cache.get(member.id);

      if (!overwrite) {
        return interaction.reply({
          content: 'This user has no channel-specific permission overwrite.',
          ephemeral: true
        });
      }

      await overwrite.delete();

      action = 'CHAT_UNDO';
      message = `↩️ Channel permission overwrite removed for ${member} in ${channel}`;
    }

    // ================= POST SUCCESS MESSAGE =================
    const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

    if (logChannel) {
      await logChannel.send({ content: message });
    }

    // ================= AUDIT LOG =================
    try {
      const sheets = getSheetsClient();

      await sheets.spreadsheets.values.append({
        spreadsheetId: AUDIT_SHEET_ID,
        range: AUDIT_RANGE,
        valueInputOption: 'RAW',
        requestBody: {
          values: [[
            new Date().toISOString(),
            interaction.user.id,
            interaction.user.tag,
            targetUser.id,
            targetUser.tag,
            channel.id,
            action
          ]]
        }
      });
    } catch (err) {
      console.error('[CHATPERMS AUDIT LOG ERROR]', err);
    }

    // ================= ACK =================
    await interaction.reply({
      content: '✅ Action completed.',
      ephemeral: true
    });
  }
};