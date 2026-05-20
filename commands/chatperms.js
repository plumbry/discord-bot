const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const { getSheets } = require('../lib/sheets');

// ================= CONSTANTS =================
const LOG_CHANNEL_ID = '1471082166535454780';
const AUDIT_SHEET_ID = process.env.MAIN_SHEET_ID;
const AUDIT_RANGE = 'Audit Log!A:G';

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

    if (!process.env.MAIN_SHEET_ID) {
      return interaction.reply({
        content: '❌ MAIN_SHEET_ID is not configured.',
        ephemeral: true
      });
    }

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

    const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

    if (logChannel) {
      await logChannel.send({ content: message });
    }

    try {
      await getSheets().spreadsheets.values.append({
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

    await interaction.reply({
      content: '✅ Action completed.',
      ephemeral: true
    });
  }
};