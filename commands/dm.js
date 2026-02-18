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
  .setDescription("Send DMs via the bot (mod only)")

  // ===== USER SUBCOMMAND =====
  .addSubcommand(sub =>
    sub
      .setName("user")
      .setDescription("Send a DM to a single user")
      .addUserOption(opt =>
        opt
          .setName("target")
          .setDescription("User to DM")
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt
          .setName("message")
          .setDescription("Message to send")
          .setRequired(true)
      )
  )

  // ===== ROLE SUBCOMMAND =====
  .addSubcommand(sub =>
    sub
      .setName("role")
      .setDescription("Send a DM to all users with a role")
      .addRoleOption(opt =>
        opt
          .setName("target")
          .setDescription("Role to DM")
          .setRequired(true)
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
  if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
    return interaction.reply({
      content: "❌ This command can only be used in the moderator channel."
    });
  }

  const sub = interaction.options.getSubcommand();
  const message = interaction.options.getString("message");

  await interaction.reply({
    content: "📨 DM process started…"
  });

  let sent = 0;
  let failed = 0;
  const failedUsers = [];

  // ===== USER =====
  if (sub === "user") {
    const user = interaction.options.getUser("target");

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

  // ===== ROLE =====
  if (sub === "role") {
    const role = interaction.options.getRole("target");
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
}

module.exports = {
  dmCommand,
  handleDM
};
