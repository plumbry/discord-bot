const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chaton')
        .setDescription('Enable chat for a role in this channel')
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('Role to enable chat for')
                .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction) {
        const role = interaction.options.getRole('role');
        const channel = interaction.channel;

        try {
            await channel.permissionOverwrites.edit(role, {
                SendMessages: true
            });

            await interaction.reply({
                content: `🔊 Chat enabled for ${role} in ${channel}.`,
                ephemeral: true
            });

        } catch (err) {
            console.error(err);

            await interaction.reply({
                content: '❌ Failed to enable chat.',
                ephemeral: true
            });
        }
    }
};