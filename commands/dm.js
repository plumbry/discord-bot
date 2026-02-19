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
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
}
if (!process.env.SPREADSHEET_ID) {
  throw new Error("Missing SPREADSHEET_ID");
}

/* ===================== GOOGLE AUTH ===================== */

const credentials = JSON.parse(
  Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8")
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
  const iso = `${date}T${time}:00.000Z`;
  const parsed = new Date(iso);
  if (isNaN(parsed.getTime())) throw new Error("Invalid date/time");
  return parsed.toISOString();
}

async function updateRow(rowNumber, row) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A${rowNumber}:Z${rowNumber}`,
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
      .setName("preview-user")
      .setDescription("Preview a DM to a user")
      .addUserOption(opt =>
        opt.setName("user").setDescription("Target user").setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName("message").setDescription("Message content").setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName("date").setDescription("Send date (UTC)")
      )
      .addStringOption(opt =>
        opt.setName("time").setDescription("Send time (UTC)")
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("preview-role")
      .setDescription("Preview a DM to a role")
      .addRoleOption(opt =>
        opt.setName("role").setDescription("Target role").setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName("message").setDescription("Message content").setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName("date").setDescription("Send date (UTC)")
      )
      .addStringOption(opt =>
        opt.setName("time").setDescription("Send time (UTC)")
      )
  );

/* ===================== COMMAND HANDLER ===================== */

async function handleDM(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const sub = interaction.options.getSubcommand();
  const message = interaction.options.getString("message");
  const date = interaction.options.getString("date");
  const time = interaction.options.getString("time");

  let sendAt = "";
  try {
    sendAt = parseUTCDateTime(date, time);
  } catch {
    return interaction.editReply("❌ Invalid date/time (UTC).");
  }

  const jobId = crypto.randomUUID();
  const isUser = sub === "preview-user";

  const targetId = isUser
    ? interaction.options.getUser("user").id
    : interaction.options.getRole("role").id;

  const targetType = isUser ? "user" : "role";
  const targetLabel = isUser ? `<@${targetId}>` : `<@&${targetId}>`;

  const embed = new EmbedBuilder()
    .setTitle("📨 DM PREVIEW")
    .setColor(0x5865f2)
    .addFields(
      { name: "Moderator", value: `<@${interaction.user.id}>` },
      { name: "Target", value: targetLabel },
      { name: "Message", value: message },
      {
        name: sendAt ? "Message Scheduled for" : "Send",
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
  const previewMessage = await channel.send({ embeds: [embed], components: [buttons] });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:Z`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        jobId,
        targetType,
        targetId,
        message,
        sendAt,
        sendAt ? "scheduled" : "pending",
        interaction.user.id,
        nowISO(),
        "",
        "",
        "",
        previewMessage.id
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
    range: `${SHEET_NAME}!A2:Z`
  });

  const rows = res.data.values || [];
  const index = rows.findIndex(r => r[0] === jobId);
  if (index === -1) return;

  const rowNumber = index + 2;
  const row = rows[index];

  if (action === "dm_cancel") {
    const cancelledAt = nowISO();

    // status
    row[5] = "cancelled";

    // remove send_at
    row[4] = "";

    // cancelled_by, cancelled_at (append-safe)
    row[11] = interaction.user.id;
    row[12] = cancelledAt;

    await updateRow(rowNumber, row);

    const cancelledEmbed = new EmbedBuilder()
      .setTitle("❌ DM CANCELLED")
      .setColor(0xed4245)
      .addFields(
        { name: "Moderator", value: `<@${interaction.user.id}>` },
        {
          name: "Target",
          value: row[1] === "user" ? `<@${row[2]}>` : `<@&${row[2]}>`
        },
        { name: "Message", value: row[3] },
        { name: "Cancelled at (UTC)", value: cancelledAt }
      );

    await interaction.message.edit({
      embeds: [cancelledEmbed],
      components: []
    });

    await interaction.channel.send("❌ DM cancelled");
    return;
  }

  if (action === "dm_confirm") {
    if (row[4]) {
      await interaction.message.edit({ components: [] });
      return;
    }

    if (row[1] === "user") {
      try {
        const user = await interaction.client.users.fetch(row[2]);
        await user.send(row[3]);

        row[5] = "sent";
        row[8] = nowISO();
        await updateRow(rowNumber, row);
      } catch (err) {
        row[5] = "failed";
        row[10] = err.message;
        await updateRow(rowNumber, row);
      }
    }

    await interaction.message.edit({ components: [] });
  }
}

/* ===================== SCHEDULER ===================== */

function startDMScheduler(client) {
  setInterval(async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SHEET_NAME}!A2:Z`
    });

    const rows = res.data.values || [];
    const now = new Date();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;

      if (row[5] !== "scheduled") continue;
      if (new Date(row[4]) > now) continue;

      // (unchanged scheduler logic)
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
