const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const { google } = require("googleapis");
const crypto = require("crypto");

const ALLOWED_CHANNEL_ID = "1471082166535454780";
const SCHEDULED_DMS_SHEET = "Scheduled DMs";

// ================= PREVIEW STATE =================
// key: previewMessageId
// value: { moderatorId, targetUserId, message, sendAt }
const previewState = new Map();

// ================= GOOGLE SHEETS AUTH =================

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 secret");
}

if (!process.env.SPREADSHEET_ID) {
  throw new Error("Missing SPREADSHEET_ID secret");
}

// Decode base64 → JSON
const serviceAccount = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

async function appendScheduledDM(row) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SCHEDULED_DMS_SHEET}!A:J`,
    valueInputOption: "RAW",
    requestBody: {
      values: [row]
    }
  });
}

// ================= SLASH COMMAND =================

const dmCommand = new SlashCommandBuilder()
  .setName("dm")
  .setDescription("Send DMs via the bot (preview + scheduling)")
  .addSubcommandGroup(group =>
    group
      .setName("preview")
      .setDescription("Preview a DM before sending or scheduling")
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
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

// ================= SLASH HANDLER =================

async function handleDM(interaction) {
  // Prevent Discord 3s timeout
  await interaction.deferReply({ ephemeral: false });

  if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
    return interaction.editReply({
      content: "❌ This command can only be used in the moderator channel."
    });
  }

  const target = interaction.options.getUser("target");
  const message = interaction.options.getString("message");
  const sendAt = interaction.options.getString("send_at");

  const deliveryLine = sendAt
    ? `🕒 **Scheduled for:** ${sendAt}`
    : `🚀 **Delivery:** Send immediately on confirmation`;

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

  const previewContent =
    `📨 **DM PREVIEW**\n\n` +
    `**Moderator:** ${interaction.user.tag} (${interaction.user.id})\n` +
    `**Target:** ${target.tag} (${target.id})\n\n` +
    `**Message:**\n${message}\n\n` +
    `${deliveryLine}\n\n` +
    `⚠️ Nothing has been sent yet.`;

  const previewMessage = await interaction.editReply({
    content: previewContent,
    components: [row],
    fetchReply: true
  });

  previewState.set(previewMessage.id, {
    moderatorId: interaction.user.id,
    targetUserId: target.id,
    message,
    sendAt
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

  previewState.delete(interaction.message.id);

  // CANCEL
  if (interaction.customId === "dm_cancel") {
    return interaction.update({
      content:
        interaction.message.content +
        `\n\n────────────────\n❌ **DM CANCELLED BY MODERATOR**`,
      components: []
    });
  }

  // CONFIRM — SCHEDULED
  if (state.sendAt) {
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();

    await appendScheduledDM([
      jobId,
      "user",
      state.targetUserId,
      state.message,
      new Date(state.sendAt).toISOString(),
      "scheduled",
      state.moderatorId,
      now,
      "",
      ""
    ]);

    return interaction.update({
      content:
        interaction.message.content +
        `\n\n────────────────\n` +
        `🕒 **DM SCHEDULED**\n` +
        `Job ID: \`${jobId}\`\n` +
        `By: <@${state.moderatorId}>`,
      components: []
    });
  }

  // CONFIRM — IMMEDIATE SEND
  try {
    const user = await interaction.client.users.fetch(state.targetUserId);
    await user.send(state.message);

    return interaction.update({
      content:
        interaction.message.content +
        `\n\n────────────────\n` +
        `✅ **DM SENT SUCCESSFULLY**\n` +
        `By: <@${state.moderatorId}>`,
      components: []
    });
  } catch (err) {
    return interaction.update({
      content:
        interaction.message.content +
        `\n\n────────────────\n` +
        `❌ **FAILED TO SEND DM**\n` +
        `Reason: ${err.message}`,
      components: []
    });
  }
}

module.exports = {
  dmCommand,
  handleDM,
  handleDMButton
};
