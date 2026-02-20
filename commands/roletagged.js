const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const delay = ms => new Promise(r => setTimeout(r, ms));
const ROLE_DELAY_MS = 750;
const MESSAGE_SCAN_LIMIT = 100;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roletagged")
    .setDescription("Give a role to all users mentioned in this channel")
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to give to mentioned users")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const role = interaction.options.getRole("role");
    const channel = interaction.channel;
    const guild = interaction.guild;

    await interaction.reply("🔍 Scanning tagged users...");

    const messages = await channel.messages.fetch({ limit: MESSAGE_SCAN_LIMIT });

    const mentionedIds = new Set();

    for (const msg of messages.values()) {
      for (const user of msg.mentions.users.values()) {
        if (!user.bot) {
          mentionedIds.add(user.id);
        }
      }
    }

    await guild.members.fetch();

    let added = 0;

    for (const userId of mentionedIds) {
      const member = guild.members.cache.get(userId);
      if (!member) continue;
      if (member.roles.cache.has(role.id)) continue;

      try {
        await member.roles.add(role);
        added++;
      } catch {}
      await delay(ROLE_DELAY_MS);
    }

    await interaction.editReply(
      `✅ Added ${role} to **${added}** tagged users.`
    );
  }
};