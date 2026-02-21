const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const MESSAGE_SCAN_LIMIT = 100;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rolecheck")
    .setDescription("Check whether all tagged users in this channel have a role")
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to check for tagged users")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const role = interaction.options.getRole("role");
    const channel = interaction.channel;
    const guild = interaction.guild;

    await interaction.reply("🔍 Checking tagged users…");

    // Fetch recent messages
    const messages = await channel.messages.fetch({ limit: MESSAGE_SCAN_LIMIT });

    const taggedUserIds = new Set();

    for (const msg of messages.values()) {
      for (const user of msg.mentions.users.values()) {
        if (!user.bot) taggedUserIds.add(user.id);
      }
    }

    if (taggedUserIds.size === 0) {
      return interaction.editReply("ℹ️ No tagged users found in recent messages.");
    }

    const missing = [];
    const hasRole = [];

    // Fetch only needed members (no guild-wide fetch)
    for (const userId of taggedUserIds) {
      try {
        const member = await guild.members.fetch(userId);

        if (member.roles.cache.has(role.id)) {
          hasRole.push(member.user.tag);
        } else {
          missing.push(member.user.tag);
        }
      } catch {
        missing.push(`Unknown User (${userId})`);
      }
    }

    let result =
      `📋 **Role Check Results**\n` +
      `Role: ${role}\n\n`;

    if (missing.length === 0) {
      result += `✅ All tagged users have this role.`;
    } else {
      result +=
        `❌ **Missing role (${missing.length}):**\n` +
        missing.map(u => `• ${u}`).join("\n");
    }

    await interaction.editReply(result);
  }
};