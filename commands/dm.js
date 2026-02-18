const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const ALLOWED_CHANNEL_ID = "1471082166535454780";

const dmCommand = new SlashCommandBuilder()
  .setName("dm")
  .setDescription("Send DMs via the bot (preview required)")

  // ===== PREVIEW =====
  .addSubcommandGroup(group =>
    group
      .setName("preview")
      .setDescription("Preview a DM before sending or scheduling")

      // USER
      .addSubcommand(sub =>
        sub
          .setName("user")
          .setDescription("Preview a DM to a single user")
          .addUserOption(opt =>
            opt.setName("target").setDescription("User to DM").setRequired(true)
          )
          .addStringOption(opt =>
            opt.setName("message").setDescription("Message to send").setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName("send_at")
              .setDescription("Optional schedule time (YYYY-MM-DD HH:MM)")
          )
      )

      // ROLE
      .addSubcommand(sub =>
        sub
          .setName("role")
          .setDescription("Preview a DM to a role")
          .addRoleOption(opt =>
            opt.setName("target").setDescription("Role to DM").setRequired(true)
          )
          .addStringOption(opt =>
            opt.setName("message").setDescription("Message to send").setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName("send_at")
              .setDescription("Optional schedule time (YYYY-MM-DD HH:MM)")
          )
      )
  )

  // ===== RESEND FAILED (stub) =====
  .addSubcommand(sub =>
    sub
      .setName("resend_failed")
      .setDescription("Resend the last failed DM batch")
  )

  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

async function handleDM(interaction) {
  // Channel lock
  if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
    return interaction.reply({
      content: "❌ This command can only be used in the moderator channel."
    });
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  // We only handle preview in this step
  if (group !== "preview") {
    return interaction.reply({
      content: "ℹ️ This function is not active yet."
    });
  }

  const message = interaction.options.getString("message");
  const sendAt = interaction.options.getString("send_at");
  const moderator = `${interaction.user.tag} (${interaction.user.id})`;

  const target =
    sub === "user"
      ? interaction.options.getUser("target")
      : interaction.options.getRole("target");

  const deliveryLine = sendAt
    ? `🕒 **Scheduled for:** ${sendAt}`
    : "🚀 **Delivery:** Send immediately on confirmation";

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dm_confirm")
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("dm_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({
    content:
      `📨 **DM PREVIEW**\n\n` +
      `**Moderator:** ${moderator}\n` +
      `**Target:** ${sub === "user" ? target.tag : target.name}\n\n` +
      `**Message:**\n${message}\n\n` +
      `${deliveryLine}\n\n` +
      `⚠️ Nothing has been sent yet.`,
    components: [row]
  });
}

module.exports = {
  dmCommand,
  handleDM
};
