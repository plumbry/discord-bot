const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

// ================= CONFIG =================
// These should already be correct in your server
const NEW_MEMBER_ROLE_ID = "1419812379692367902";     // New Member
const VERIFIED_ROLE_ID = "1371623256855154818";  // Yunite Verified

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roleverifycheck")
    .setDescription("Check which new members also have the verified role")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const guild = interaction.guild;

    await interaction.reply("🔍 Checking roles…");

    const newMemberRole = guild.roles.cache.get(NEW_MEMBER_ROLE_ID);
    const verifiedRole = guild.roles.cache.get(VERIFIED_ROLE_ID);

    if (!newMemberRole || !verifiedRole) {
      return interaction.editReply(
        "❌ Required roles not found. Check role IDs."
      );
    }

    // IMPORTANT: use role.members (no guild-wide fetch)
    const membersWithNewRole = [...newMemberRole.members.values()];

    if (membersWithNewRole.length === 0) {
      return interaction.editReply(
        "ℹ️ No members currently have the New Member role."
      );
    }

    const bothRoles = [];

    for (const member of membersWithNewRole) {
      if (member.roles.cache.has(verifiedRole.id)) {
        bothRoles.push(`<@${member.id}>`);
      }
    }

    let result =
      `📋 **Role Verification Check**\n` +
      `New Member role holders: **${membersWithNewRole.length}**\n` +
      `Have both roles: **${bothRoles.length}**\n\n`;

    if (bothRoles.length === 0) {
      result += "❌ No members currently have both roles.";
    } else {
      result += bothRoles.join("\n");
    }

    await interaction.editReply(result);
  }
};