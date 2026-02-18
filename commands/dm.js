const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");
const { google } = require("googleapis");
const crypto = require("crypto");

const MOD_CHANNEL_ID = "1471082166535454780";
const SHEET_NAME = "Scheduled DMs";

/* ===================== ENV GUARDS ===================== */

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 secret");
}

if (!process.env.SPREADSHEET_ID) {
  throw new Error("Missing SPREADSHEET_ID secret");
}

/* ===================== GOOGLE AUTH ===================== */

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(
    Buffer.from(
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
      "base64"
    ).toString("utf8")
  ),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

/* ===================== UTIL ===================== */

const nowISO = () => new Date().toISOString();

/* ===================== SLASH COMMAND ===================== */

const dmCommand = new SlashCommandBuilder()
  .setName("dm")
  .setDescription("Send or schedule DMs")
  .addSubcommand(sub =>
    sub
      .setName("preview")
      .setDescription("Preview a DM before sending or scheduling")
      .addUserOption(opt =>
        opt.setName("user").setDescription("Target user").setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName("message").setDescription("Message content").setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName("send_at")
          .setDescription("ISO time (UTC) to schedule, or omit to send now")
          .setRequired(false)
      )
  );

/* ===================== HANDLERS ===================== */

async function handleDM(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const user = interaction.options.getUser("user");
  const message = interaction.options.getString("message");
  const sendAtRaw = interaction.options.getString("send_at");

  const sendAt = sendAtRaw ? new Date(sendAtRaw).toISOString() : null;
  const jobId = crypto.randomUUID();

  const embed = new EmbedBuilder()
    .setTitle("📨 DM PREVIEW")
    .addFields(
      { name: "Moderator", value: `<@${interaction.user.id}>` },
      { name: "Target", value: `<@${user.id}>` },
      { name: "Message", value: message },
      {
        name: sendAt ? "Scheduled for" : "Send",
        value: sendAt ? sendAt : "Immediately"
      }
    )
    .setColor(0x5865f2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dm_confirm:${jobId}`)
      .setLabel("Confirm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`dm_cancel:${jobId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  const channel = await interaction.client.channels.fetch(MOD_CHANNEL_ID);
  const previewMsg = await channel.send({ embeds: [embed], components: [row] });

  // Store job
  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:K`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        jobId,
        "user",
        user.id,
        message,
        sendAt ?? "",
        sendAt ? "scheduled" : "pending",
        interaction.user.id,
        nowISO(),
        "",
        "",
        previewMsg.id
      ]]
    }
  });

  await interaction.editReply("Preview posted.");
}

async function handleDMButton(interaction) {
  const [action, jobId] = interaction.customId.split(":");

  await interaction.deferUpdate();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:K`
  });

  const rows = res.data.values || [];
  const index = rows.findIndex(r => r[0] === jobId);
  if (index === -1) return;

  const rowNumber = index + 2;
  const row = rows[index];

  if (action === "dm_cancel") {
    row[5] = "cancelled";
    await updateRow(rowNumber, row);
    await interaction.message.edit({ components: [] });
    return;
  }

  if (action === "dm_confirm") {
    if (row[4]) {
      // scheduled — do nothing now
      await interaction.message.edit({ components: [] });
      return;
    }

    // send immediately
    try {
      const user = await interaction.client.users.fetch(row[2]);
      await user.send(row[3]);

      row[5] = "sent";
      row[8] = nowISO();
      row[9] = "";

      await updateRow(rowNumber, row);
      await interaction.message.edit({ components: [] });
    } catch (err) {
      row[5] = "failed";
      row[9] = err.message;
      await updateRow(rowNumber, row);
    }
  }
}

async function updateRow(rowNumber, row) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${rowNumber}:K${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [row] }
  });
}

/* ===================== SCHEDULER ===================== */

function startDMScheduler(client) {
  setInterval(async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:K`
    });

    const rows = res.data.values || [];
    const now = new Date();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      if (row[5] !== "scheduled") continue;
      if (new Date(row[4]) > now) continue;

      try {
        const user = await client.users.fetch(row[2]);
        await user.send(row[3]);

        row[5] = "sent";
        row[8] = nowISO();
        row[9] = "";

        await updateRow(rowNum, row);

        const channel = await client.channels.fetch(MOD_CHANNEL_ID);
        const msg = await channel.messages.fetch(row[10]);
        await msg.edit({ components: [] });
      } catch (err) {
        row[5] = "failed";
        row[9] = err.message;
        await updateRow(rowNum, row);
      }

      await new Promise(r => setTimeout(r, 1200));
    }
  }, 30_000);
}

/* ===================== EXPORT ===================== */

module.exports = {
  dmCommand,
  handleDM,
  handleDMButton,
  startDMScheduler
};
