const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const ALLOWED_CHANNEL_ID = "1471082166535454780";

// ---- Rate limit helper ----
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const DM_DELAY_MS = 900;

const dmCommand = new SlashCommandBuilder()
  .setName("dm")
  .setDescription("Send a DM to a user or a role")
  .addSubcommand(sub =>
    sub
      .setName("send")
      .setDescription("Send a DM")
      .addUserOption(opt =>
        opt.setName("user").setDescription("User to DM")
      )
      .addRoleOption(opt =>
        opt.setName("role").setDescription("Role to DM")
      )
      .addStringOption(opt =>
        opt
          .setName("message")
          .setDescription("Message to send")
          .setRequired(true)
      )
  )
  .setDefaultMemberPermissions(
    PermissionFlagsBits.ModerateMembers |
    PermissionFlagsBits.Administrator
  );

async function handleDM(interaction) {
  // Hard channel lock
  if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
    return interaction.reply({
      content: "❌ This command can only be used in the moderator channel."
    });
  }

  const user = interaction.options.getUser("user");
  const role = interaction.options.getRole("role");
  const message = interaction.options.getString("message");

  if (!user && !role) {
    return interaction.reply({
      content: "❌ You must specify either a user or a role."
    });
  }

  if (user && role) {
    return interaction.reply({
      content: "❌ Choose either a user or a role, not both."
    });
  }

  await interaction.reply({
    content: "📨 DM process started…"
  });

  let sent = 0;
  let failed = 0;
  const failedUsers = [];

  // ===== SINGLE USER =====
  if (user) {
    try {
      await user.send(message);
      sent++;
    } catch {
      failed++;
      failedUsers.push(`${user.tag} (${user.id})`);
    }

    return interaction.channel.send({
      content:
        `📤 **DM Result**\n` +
        `**Moderator:** ${interaction.user.tag}\n` +
        `**Target:** ${user.tag}\n` +
        `**Message:**\n${message}\n\n` +
        `✅ Sent: ${sent}\n` +
        `❌ Failed: ${failed}` +
        (failedUsers.length
          ? `\n\n⚠️ **Could not DM:**\n${failedUsers.join("\n")}`
          : "")
    });
  }

  // ===== ROLE (rate-limited) =====
  const members = await interaction.guild.members.fetch();
  const targets = members.filter(
    m => m.roles.cache.has(role.id) && !m.user.bot
  );

  for (const [, member] of targets) {
    try {
      await member.send(message);
      sent++;
    } catch {
      failed++;
      failedUsers.push(`${member.user.tag} (${member.user.id})`);
    }

    // Rate limit delay
    await wait(DM_DELAY_MS);
  }

  return interaction.channel.send({
    content:
      `📤 **Role DM Result**\n` +
      `**Moderator:** ${interaction.user.tag}\n` +
      `**Role:** ${role.name}\n` +
      `**Message:**\n${message}\n\n` +
      `✅ Sent: ${sent}\n` +
      `❌ Failed: ${failed}` +
      (failedUsers.length
        ? `\n\n⚠️ **Could not DM:**\n${failedUsers.join("\n")}`
        : "")
  });
}

module.exports = {
  dmCommand,
  handleDM
};
