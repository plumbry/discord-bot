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
  .addSubcommandGroup(group =>
    group
      .setName("preview")
      .setDescription("Preview a DM")
      .addSubcommand(sub =>
        sub
          .setName("user")
          .setDescription("Preview a DM to a user")
          .addUserOption(opt =>
            opt.setName("target").setDescription("User").setRequired(true)
          )
          .addStringOption(opt =>
            opt.setName("message").setDescription("Message").setRequired(true)
          )
          .addStringOption(opt =>
            opt.setName("send_at").setDescription("Optional schedule time")
          )
      )
      .addSubcommand(sub =>
        sub
          .setName("role")
          .setDescription("Preview a DM to a role")
          .addRoleOption(opt =>
            opt.setName("target").setDescription("Role").setRequired(true)
          )
          .addStringOption(opt =>
            opt.setName("message").setDescription("Message").setRequired(true)
          )
          .addStringOption(opt =>
            opt.setName("send_at").setDescription("Optional schedule time")
          )
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("resend_failed")
      .setDescription("Resend the last failed DM batch")
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

async function handleDM(interaction) {
  if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
    return interaction.reply({ content: "❌ Wrong channel." });
  }

  const message = interaction.options.getString("message");
  const sendAt = interaction.options.getString("send_at");
  const sub = interaction.options.getSubcommand();
  const target =
    sub === "user"
      ? interaction.options.getUser("target")
      : interaction.options.getRole("target");

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
      `**Moderator:** ${interaction.user.tag} (${interaction.user.id})\n` +
      `**Target:** ${sub === "user" ? target.tag : target.name}\n\n` +
      `**Message:**\n${message}\n\n` +
      (sendAt
        ? `🕒 **Scheduled for:** ${sendAt}\n\n`
        : "🚀 **Delivery:** Send immediately on confirmation\n\n") +
      `⚠️ Nothing has been sent yet.`,
    components: [row]
  });
}

// BUTTON HANDLER (STUB)
async function handleDMButton(interaction) {
  if (!["dm_confirm", "dm_cancel"].includes(interaction.customId)) return;

  if (interaction.customId === "dm_confirm") {
    return interaction.reply({
      content: "✅ Confirmed. (Sending not enabled yet)",
      ephemeral: true
    });
  }

  if (interaction.customId === "dm_cancel") {
    return interaction.reply({
      content: "❌ DM cancelled.",
      ephemeral: true
    });
  }
}

module.exports = {
  dmCommand,
  handleDM,
  handleDMButton
};
