const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const ALLOWED_CHANNEL_ID = "1471082166535454780";

// In-memory preview state
// key: previewMessageId
// value: { moderatorId, targetUserId, message }
const previewState = new Map();

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
          .setDescription("Preview a DM to a single user")
          .addUserOption(opt =>
            opt.setName("target").setDescription("User").setRequired(true)
          )
          .addStringOption(opt =>
            opt.setName("message").setDescription("Message").setRequired(true)
          )
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("resend_failed")
      .setDescription("Resend the last failed DM batch (not active yet)")
  )

  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

// ================= SLASH HANDLER =================
async function handleDM(interaction) {
  if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
    return interaction.reply({
      content: "❌ This command can only be used in the moderator channel."
    });
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group !== "preview" || sub !== "user") {
    return interaction.reply({
      content: "ℹ️ This function is not active yet."
    });
  }

  const target = interaction.options.getUser("target");
  const message = interaction.options.getString("message");

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

  const previewMessage = await interaction.reply({
    content:
      `📨 **DM PREVIEW**\n\n` +
      `**Moderator:** ${interaction.user.tag} (${interaction.user.id})\n` +
      `**Target:** ${target.tag} (${target.id})\n\n` +
      `**Message:**\n${message}\n\n` +
      `🚀 **Delivery:** Send immediately on confirmation\n\n` +
      `⚠️ Nothing has been sent yet.`,
    components: [row],
    fetchReply: true
  });

  previewState.set(previewMessage.id, {
    moderatorId: interaction.user.id,
    targetUserId: target.id,
    message
  });
}

// ================= BUTTON HANDLER =================
async function handleDMButton(interaction) {
  if (!["dm_confirm", "dm_cancel"].includes(interaction.customId)) return;

  const state = previewState.get(interaction.message.id);

  if (!state) {
    return interaction.update({
      content:
        interaction.message.content +
        `\n\n❌ **This DM preview is no longer valid.**`,
      components: []
    });
  }

  if (interaction.user.id !== state.moderatorId) {
    return interaction.reply({
      content: "❌ Only the moderator who created this preview can use these buttons.",
      ephemeral: true
    });
  }

  // ---------- CANCEL ----------
  if (interaction.customId === "dm_cancel") {
    previewState.delete(interaction.message.id);

    return interaction.update({
      content:
        interaction.message.content +
        `\n\n────────────────\n❌ **DM CANCELLED BY MODERATOR**`,
      components: []
    });
  }

  // ---------- CONFIRM ----------
  if (interaction.customId === "dm_confirm") {
    previewState.delete(interaction.message.id);

    let resultLine;

    try {
      const user = await interaction.client.users.fetch(state.targetUserId);
      await user.send(state.message);

      resultLine =
        `\n\n────────────────\n` +
        `✅ **DM SENT SUCCESSFULLY**\n` +
        `By: <@${state.moderatorId}>`;
    } catch (err) {
      resultLine =
        `\n\n────────────────\n` +
        `❌ **FAILED TO SEND DM**\n` +
        `Reason: ${err.message}`;
    }

    return interaction.update({
      content: interaction.message.content + resultLine,
      components: []
    });
  }
}

module.exports = {
  dmCommand,
  handleDM,
  handleDMButton
};
