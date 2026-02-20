const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chatperms')
    .setDescription('Toggle send message permissions for a user in this channel')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User to toggle chat permissions for')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
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

    const overwrite = channel.permissionOverwrites.cache.get(member.id);
    const currentlyDenied = overwrite?.deny?.has(PermissionFlagsBits.SendMessages);

    const newState = !currentlyDenied;

    await channel.permissionOverwrites.edit(member, {
      SendMessages: newState ? false : null
    });

    const actionText = newState
      ? '🔒 Chat disabled for'
      : '🔓 Chat enabled for';

    await interaction.reply({
      content: `${actionText} ${member}`
    });
  }
};