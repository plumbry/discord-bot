const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const dmCommand = new SlashCommandBuilder()
  .setName("dm")
  .setDescription("Send DMs via the bot (preview required)")

  // ===== PREVIEW =====
  .addSubcommandGroup(group =>
    group
      .setName("preview")
      .setDescription("Preview a DM before sending or scheduling")

      // --- USER ---
      .addSubcommand(sub =>
        sub
          .setName("user")
          .setDescription("Preview a DM to a single user")
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
          .addStringOption(opt =>
            opt
              .setName("send_at")
              .setDescription("Optional schedule time (YYYY-MM-DD HH:MM)")
              .setRequired(false)
          )
      )

      // --- ROLE ---
      .addSubcommand(sub =>
        sub
          .setName("role")
          .setDescription("Preview a DM to a role")
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
          .addStringOption(opt =>
            opt
              .setName("send_at")
              .setDescription("Optional schedule time (YYYY-MM-DD HH:MM)")
              .setRequired(false)
          )
      )
  )

  // ===== RESEND FAILED =====
  .addSubcommand(sub =>
    sub
      .setName("resend_failed")
      .setDescription("Resend the last failed DM batch")
  )

  // 🔒 Visibility permission
  .setDefaultMemberPermissions(
    PermissionFlagsBits.ManageRoles
  );

module.exports = {
  dmCommand
};
