const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

// ================= CONFIG =================
const NEW_MEMBER_ROLE_ID = "1419812379692367902"; // New Member
const VERIFIED_ROLE_ID = "1371623256855154818";   // Yunite Verified

const MAX_LISTED_USERS = 20;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roleverifycheck")
    .setDescription("Check which New Members also have the Yunite Verified role")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const guild = interaction.guild;

    await interaction.reply("🔍 Checking New Members…");

    // Fetch ONLY members with New Member role
    const membersWithNewRole = await guild.members.fetch({
      withRoles: [NEW_MEMBER_ROLE_ID]
    });

    if (membersWithNewRole.size === 0) {
      return interaction.editReply(
        "ℹ️ No members currently have the New Member role."
      );
    }

    const verifiedMembers = [];

    for (const member of membersWithNewRole.values()) {
      if (member.roles.cache.has(VERIFIED_ROLE_ID)) {
        verifiedMembers.push(`<@${member.id}>`);
      }
    }

    const shown = verifiedMembers.slice(0, MAX_LISTED_USERS);
    const remaining = verifiedMembers.length - shown.length;

    let message =
      `📋 **Role Verification Check**\n` +
      `New Members: **${membersWithNewRole.size}**\n` +
      `Have Yunite Verified: **${verifiedMembers.length}**\n\n`;

    if (verifiedMembers.length === 0) {
      message += "❌ No New Members currently have the verified role.";
    } else {
      message += shown.join("\n");

      if (remaining > 0) {
        message += `\n… and **${remaining}** more`;
      }
    }

    await interaction.editReply(message);
  }
};