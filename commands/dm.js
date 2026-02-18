const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");
const { google } = require("googleapis");
const crypto = require("crypto");

/* ===================== CONSTANTS ===================== */

const MOD_CHANNEL_ID = "1471082166535454780";
const SHEET_NAME = "Scheduled DMs";

/* ===================== ENV GUARANTEES ===================== */

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
  throw new Error(
    "Missing GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 (required for Google Sheets auth)"
  );
}

if (!process.env.SPREADSHEET_ID) {
  throw new Error(
    "Missing SPREADSHEET_ID (required to locate Scheduled DMs sheet)"
  );
}

/* ===================== GOOGLE AUTH ===================== */

const credentials = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

/* ===================== HELPERS ===================== */

const nowISO = () => new Date().toISOString();

function parseUTCDateTime(date, time) {
  if (!date || !time) return "";

  // Expect YYYY-MM-DD and HH:MM
  const iso = `${date}T${time}:00.000Z`;
  const parsed = new Date(iso);

  if (isNaN(parsed.getTime())) {
    throw new Error("Invalid date or time format");
  }

  return parsed.toISOString();
}

async function updateRow(rowNumber, row) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${rowNumber}:K${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [row] }
  });
}

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
        opt
          .setName("date")
          .setDescription("Send date (UTC) in YYYY-MM-DD")
          .setRequired(false)
      )
      .addStringOption(opt =>
        opt
          .setName("time")
          .setDescription("Send time (UTC) in HH:MM (24h)")
          .setRequired(false)
      )
  );

/* ===================== COMMAND HANDLER ===================== */

async function handleDM(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const targetUser = interaction.options.getUser("user");
  const message = interaction.options.getString("message");
  const date = interaction.options.getString("date");
  const time = interaction.options.getString("time");

  let sendAt = "";

  try {
    sendAt = parseUTCDateTime(date, time);
  } catch (err) {
    return interaction.editReply(
      "❌ Invalid date/time. Use YYYY-MM-DD and HH:MM (UTC)."
    );
  }

  const jobId = crypto.randomUUID();

  const embed = new EmbedBuilder()
    .setTitle("📨 DM PREVIEW")
    .setColor(0x5865f2)
    .addFields(
      { name: "Moderator", value: `<@${interaction.user.id}>` },
      { name: "Target", value: `<@${targetUser.id}>` },
      { name: "Message", value: message },
      {
        name: sendAt ? "Scheduled For (UTC)" : "Send",
        value: sendAt || "Immediately"
      }
    );

  const buttons = new ActionRowBuilder().addComponents(
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
  const previewMessage = await channel.send({
    embeds: [embed],
    components: [buttons]
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:K`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        jobId,                     // A jobId
        "user",                    // B targetType
        targetUser.id,             // C targetId
        message,                   // D message
        sendAt,                    // E sendAt
        sendAt ? "scheduled" : "pending", // F status
        interaction.user.id,       // G moderatorId
        nowISO(),                  // H createdAt
        "",                         // I sentAt
        "",                         // J error
        previewMessage.id          // K previewMessageId
      ]]
    }
  });

  await interaction.editReply("✅ Preview posted.");
}

/* ===================== BUTTON HANDLER ===================== */

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
      // scheduled
      await interaction.message.edit({ components: [] });
      return;
    }

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
      const rowNumber = i + 2;

      if (row[5] !== "scheduled") continue;
      if (new Date(row[4]) > now) continue;

      try {
        const user = await client.users.fetch(row[2]);
        await user.send(row[3]);

        row[5] = "sent";
        row[8] = nowISO();
        row[9] = "";

        await updateRow(rowNumber, row);

        const channel = await client.channels.fetch(MOD_CHANNEL_ID);
        const msg = await channel.messages.fetch(row[10]);
        await msg.edit({ components: [] });
      } catch (err) {
        row[5] = "failed";
        row[9] = err.message;
        await updateRow(rowNumber, row);
      }

      await new Promise(r => setTimeout(r, 1200));
    }
  }, 30_000);
}

/* ===================== EXPORTS ===================== */

module.exports = {
  dmCommand,
  handleDM,
  handleDMButton,
  startDMScheduler
};
