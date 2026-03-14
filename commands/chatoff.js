const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chatoff')
        .setDescription('Disable chat permissions for a role in this channel.')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('The role to disable chat for')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        const role = interaction.options.getRole('role');
        const channel = interaction.channel;

        try {
            await channel.permissionOverwrites.edit(role, {
                SendMessages: false
            });

            await interaction.reply({
                content: `🔇 Chat disabled for ${role} in ${channel}.`,
                ephemeral: true
            });

        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: '❌ Failed to disable chat permissions.',
                ephemeral: true
            });
        }
    },
};