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
const previewState = new Map();

// ================= GOOGLE AUTH =================
if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
}
if (!process.env.SPREADSHEET_ID) {
  throw new Error("Missing SPREADSHEET_ID");
}

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

const sheets = google.sheets({ version: "v4", auth });

// ================= COMMAND =================
const dmCommand = new SlashCommandBuilder()
  .setName("dm")
  .setDescription("Send or schedule DMs")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommandGroup(group =>
    group
      .setName("preview")
      .setDescription("Preview a DM")
      .addSubcommand(sub =>
        sub
          .setName("user")
          .setDescription("Preview a DM to a user")
          .addUserOption(o =>
            o.setName("target").setDescription("User").setRequired(true)
          )
          .addStringOption(o =>
            o.setName("message").setDescription("Message").setRequired(true)
          )
          .addStringOption(o =>
            o.setName("send_at")
              .setDescription("UTC time YYYY-MM-DD HH:MM")
          )
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("cancel")
      .setDescription("Cancel a scheduled DM")
      .addStringOption(o =>
        o.setName("job_id").setDescription("Job ID").setRequired(true)
      )
  );

// ================= SLASH HANDLER =================
async function handleDM(interaction) {
  await interaction.deferReply({ ephemeral: false });

  if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
    return interaction.editReply("❌ This command can only be used in the mod channel.");
  }

  // ---------- CANCEL ----------
  if (interaction.options.getSubcommand() === "cancel") {
    const jobId = interaction.options.getString("job_id");

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SCHEDULED_DMS_SHEET}!A2:K`
    });

    const rows = res.data.values || [];
    const index = rows.findIndex(r => r[0] === jobId);

    if (index === -1) {
      return interaction.editReply("❌ Job ID not found.");
    }

    if (rows[index][5] !== "scheduled") {
      return interaction.editReply("❌ That DM is no longer scheduled.");
    }

    const rowNum = index + 2;

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SCHEDULED_DMS_SHEET}!F${rowNum}:J${rowNum}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          "cancelled",
          interaction.user.id,
          new Date().toISOString(),
          "",
          `Cancelled by ${interaction.user.id}`
        ]]
      }
    });

    const previewMessageId = rows[index][10];
    try {
      const channel = await interaction.client.channels.fetch(ALLOWED_CHANNEL_ID);
      const msg = await channel.messages.fetch(previewMessageId);
      await msg.edit(
        msg.content +
        `\n\n──────────────\n🛑 **DM CANCELLED**\nBy: <@${interaction.user.id}>`
      );
    } catch {}

    return interaction.editReply(`🛑 Scheduled DM **${jobId}** cancelled.`);
  }

  // ---------- PREVIEW ----------
  const target = interaction.options.getUser("target");
  const message = interaction.options.getString("message");
  const sendAt = interaction.options.getString("send_at");

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dm_confirm")
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("dm_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  const previewMsg = await interaction.editReply({
    content:
      `📨 **DM PREVIEW**\n\n` +
      `**Moderator:** <@${interaction.user.id}>\n` +
      `**Target:** <@${target.id}>\n\n` +
      `**Message:**\n${message}\n\n` +
      (sendAt
        ? `🕒 **Scheduled for:** ${sendAt} UTC\n`
        : `🚀 **Send immediately on confirmation**\n`) +
      `⚠️ Nothing has been sent yet.`,
    components: [buttons],
    fetchReply: true
  });

  previewState.set(previewMsg.id, {
    moderatorId: interaction.user.id,
    targetId: target.id,
    message,
    sendAt
  });
}

// ================= BUTTON HANDLER =================
async function handleDMButton(interaction) {
  if (!["dm_confirm", "dm_cancel"].includes(interaction.customId)) return;

  const state = previewState.get(interaction.message.id);
  if (!state) return;

  if (interaction.user.id !== state.moderatorId) {
    return interaction.reply({ content: "❌ Not your preview.", ephemeral: true });
  }

  previewState.delete(interaction.message.id);

  if (interaction.customId === "dm_cancel") {
    return interaction.update({
      content: interaction.message.content + "\n\n❌ **Cancelled**",
      components: []
    });
  }

  // ---------- SCHEDULE ----------
  if (state.sendAt) {
    const jobId = crypto.randomUUID();

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SCHEDULED_DMS_SHEET}!A:K`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          jobId,
          "user",
          state.targetId,
          state.message,
          new Date(state.sendAt).toISOString(),
          "scheduled",
          state.moderatorId,
          new Date().toISOString(),
          "",
          "",
          interaction.message.id
        ]]
      }
    });

    return interaction.update({
      content:
        interaction.message.content +
        `\n\n──────────────\n🕒 **DM SCHEDULED**\nJob ID: \`${jobId}\``,
      components: []
    });
  }

  // ---------- IMMEDIATE SEND ----------
  try {
    const user = await interaction.client.users.fetch(state.targetId);
    await user.send(state.message);

    return interaction.update({
      content: interaction.message.content + "\n\n✅ **DM SENT**",
      components: []
    });
  } catch (err) {
    return interaction.update({
      content:
        interaction.message.content +
        `\n\n❌ **FAILED**\n${err.message}`,
      components: []
    });
  }
}

module.exports = {
  dmCommand,
  handleDM,
  handleDMButton
};
