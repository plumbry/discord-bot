const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const delay = ms => new Promise(r => setTimeout(r, ms));
const ROLE_DELAY_MS = 750;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roleclear")
    .setDescription("Remove a role from all members who have it")
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to remove from all members")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const role = interaction.options.getRole("role");
    const guild = interaction.guild;

    await interaction.reply(`⏳ Removing ${role} from all members...`);

    await guild.members.fetch();

    const members = guild.members.cache.filter(
      m => !m.user.bot && m.roles.cache.has(role.id)
    );

    let removed = 0;

    for (const member of members.values()) {
      try {
        await member.roles.remove(role);
        removed++;
      } catch {}
      await delay(ROLE_DELAY_MS);
    }

    await interaction.editReply(
      `✅ Removed ${role} from **${removed}** members.`
    );
  }
};