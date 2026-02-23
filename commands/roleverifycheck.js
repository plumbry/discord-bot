const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

// ================= CONFIG =================
const NEW_MEMBER_ROLE_ID = "1419812379692367902";     // New Member
const VERIFIED_ROLE_ID = "1371623256855154818";  // Yunite Verified

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roleverifycheck")
    .setDescription("Check which new members are missing the verified role")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const guild = interaction.guild;

    await interaction.reply("🔍 Checking verification status…");

    const newMemberRole = guild.roles.cache.get(NEW_MEMBER_ROLE_ID);
    const verifiedRole = guild.roles.cache.get(VERIFIED_ROLE_ID);

    if (!newMemberRole || !verifiedRole) {
      return interaction.editReply(
        "❌ Required roles not found. Check role IDs."
      );
    }

    // Use role.members to avoid gateway chunking
    const members = [...newMemberRole.members.values()];

    if (members.length === 0) {
      return interaction.editReply(
        "ℹ️ No members currently have the New Member role."
      );
    }

    const missing = [];

    for (const member of members) {
      if (!member.roles.cache.has(verifiedRole.id)) {
        missing.push(`<@${member.id}>`);
      }
    }

    let result =
      `📋 **Verification Check**\n` +
      `New Members checked: **${members.length}**\n`;

    if (missing.length === 0) {
      result += `✅ All new members are verified.`;
    } else {
      result +=
        `❌ Missing verified role: **${missing.length}**\n\n` +
        missing.join("\n");
    }

    await interaction.editReply(result);
  }
};