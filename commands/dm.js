```js
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

const ROLE_DM_DELAY_MS = 1200;
const USER_DM_DELAY_MS = 750;

let schedulerRunning = false;

/* ===================== ENV ===================== */

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64)
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");

if (!process.env.MAIN_SHEET_ID)
  throw new Error("Missing MAIN_SHEET_ID");

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
const delay = ms => new Promise(r => setTimeout(r, ms));

function parseUTCDateTime(date, time) {

  if (!date || !time) return "";

  const iso = `${date}T${time}:00.000Z`;
  const parsed = new Date(iso);

  if (isNaN(parsed.getTime()))
    throw new Error("Invalid date/time");

  return parsed.toISOString();
}

async function updateRow(rowNumber, row) {

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.MAIN_SHEET_ID,
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
      .addUserOption(o =>
        o.setName("user")
          .setDescription("Target user")
          .setRequired(true))
      .addStringOption(o =>
        o.setName("message")
          .setDescription("Message content")
          .setRequired(true))
      .addStringOption(o =>
        o.setName("date")
          .setDescription("Send date (UTC)"))
      .addStringOption(o =>
        o.setName("time")
          .setDescription("Send time (UTC)"))
  )

  .addSubcommand(sub =>
    sub
      .setName("preview-role")
      .setDescription("Preview a DM to a role")
      .addRoleOption(o =>
        o.setName("role")
          .setDescription("Target role")
          .setRequired(true))
      .addStringOption(o =>
        o.setName("message")
          .setDescription("Message content")
          .setRequired(true))
      .addStringOption(o =>
        o.setName("date")
          .setDescription("Send date (UTC)"))
      .addStringOption(o =>
        o.setName("time")
          .setDescription("Send time (UTC)"))
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

  const embed = new EmbedBuilder()
    .setTitle("📨 DM PREVIEW")
    .setColor(0x5865f2)
    .addFields(
      { name: "Moderator", value: `<@${interaction.user.id}>` },
      {
        name: "Target",
        value: isUser ? `<@${targetId}>` : `<@&${targetId}>`
      },
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

  const previewMessage = await channel.send({
    embeds: [embed],
    components: [buttons]
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: `${SHEET_NAME}!A:Z`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        jobId,
        isUser ? "user" : "role",
        targetId,
        message,
        sendAt,
        sendAt ? "scheduled" : "pending",
        interaction.user.id,
        nowISO(),
        "",
        "",
        "",
        "",
        "",
        previewMessage.id,
        interaction.guildId
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
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: `${SHEET_NAME}!A2:Z`
  });

  const rows = res.data.values || [];
  const index = rows.findIndex(r => r[0] === jobId);

  if (index === -1) return;

  const rowNumber = index + 2;
  const row = rows[index];

  if (action === "dm_cancel") {

    row[5] = "cancelled";
    row[4] = "";
    row[11] = interaction.user.id;
    row[12] = nowISO();

    await updateRow(rowNumber, row);

    await interaction.message.edit({ components: [] });

    return;
  }

  if (action === "dm_confirm") {

    if (!row[4]) {
      row[4] = nowISO();
      row[5] = "scheduled";
      await updateRow(rowNumber, row);
    }

    await interaction.message.edit({ components: [] });
  }
}

/* ===================== SCHEDULER ===================== */

function startDMScheduler(client) {

  setInterval(async () => {

    if (schedulerRunning) return;

    schedulerRunning = true;

    try {

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: process.env.MAIN_SHEET_ID,
        range: `${SHEET_NAME}!A2:Z`
      });

      const rows = res.data.values || [];
      const now = new Date();

      for (let i = 0; i < rows.length; i++) {

        const row = rows[i];
        const rowNumber = i + 2;

        if (row[5] !== "scheduled") continue;
        if (new Date(row[4]) > now) continue;

        let total = 0;
        let sent = 0;
        let failed = [];

        try {

          if (row[1] === "user") {

            total = 1;

            const user = await client.users.fetch(row[2]);

            await user.send(row[3]);

            sent = 1;

            await delay(USER_DM_DELAY_MS);

          } else {

            const guild = await client.guilds.fetch(row[14]);

            await guild.members.fetch();

            const members = guild.members.cache.filter(m =>
              m.roles.cache.has(row[2])
            );

            total = members.size;

            for (const member of members.values()) {

              try {
                await member.send(row[3]);
                sent++;
              } catch {
                failed.push(member.id);
              }

              await delay(ROLE_DM_DELAY_MS);
            }
          }

          row[5] =
            sent === 0 ? "failed" :
            sent < total ? "partially_sent" :
            "sent";

          row[8] = nowISO();

        } catch (err) {

          row[5] = "failed";
          row[10] = err.message;
        }

        row[9] = failed.join(",");

        await updateRow(rowNumber, row);
      }

    } finally {
      schedulerRunning = false;
    }

  }, 30000);
}

/* ===================== EXPORTS ===================== */

module.exports = {
  data: dmCommand,
  execute: handleDM,
  dmCommand,
  handleDM,
  handleDMButton,
  startDMScheduler
};
```
