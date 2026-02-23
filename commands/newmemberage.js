const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

// ================= CONFIG =================
const NEW_MEMBER_ROLE_ID = "1419812379692367902"; // New Member
const DAYS_THRESHOLD = 30;
const MAX_LISTED_USERS = 20;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("newmemberage")
    .setDescription("List New Members who joined more than 30 days ago")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const guild = interaction.guild;

    await interaction.reply("🔍 Checking New Member join dates…");

    // REQUIRED: fetch all members for accurate join dates
    const allMembers = await guild.members.fetch();

    const now = Date.now();
    const thresholdMs = DAYS_THRESHOLD * 24 * 60 * 60 * 1000;

    const oldNewMembers = [];

    for (const member of allMembers.values()) {
      if (!member.roles.cache.has(NEW_MEMBER_ROLE_ID)) continue;
      if (!member.joinedTimestamp) continue;

      const ageMs = now - member.joinedTimestamp;

      if (ageMs >= thresholdMs) {
        oldNewMembers.push({
          id: member.id,
          joined: member.joinedTimestamp
        });
      }
    }

    if (oldNewMembers.length === 0) {
      return interaction.editReply(
        "✅ No New Members have been in the server longer than 30 days."
      );
    }

    // Oldest first (optional but useful)
    oldNewMembers.sort((a, b) => a.joined - b.joined);

    const shown = oldNewMembers.slice(0, MAX_LISTED_USERS);
    const remaining = oldNewMembers.length - shown.length;

    let message =
      `📋 **New Members Over ${DAYS_THRESHOLD} Days**\n` +
      `Total New Members over ${DAYS_THRESHOLD} days: **${oldNewMembers.length}**\n\n`;

    message += shown
      .map(u => `<@${u.id}> — joined <t:${Math.floor(u.joined / 1000)}:R>`)
      .join("\n");

    if (remaining > 0) {
      message += `\n… and **${remaining}** more`;
    }

    await interaction.editReply(message);
  }
};