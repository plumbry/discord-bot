const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");
const { google } = require("googleapis");

// ================= CONFIG =================
const SHEET_ID = "PASTE_REAL_SHEET_ID";
const EVENT_SHEET = "Event Bans";
const AUDIT_SHEET = "Audit Log";
const BAN_CHANNEL_ID = "1472795189515915466";

// ================= GOOGLE AUTH =================
const credentials = JSON.parse(
  Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64")
    .toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// ================= HELPERS =================
function formatDate(date) {
  return date.toLocaleDateString("en-GB");
}

function today() {
  return formatDate(new Date());
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d;
}

async function logAudit(action, moderator, user) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${AUDIT_SHEET}!A2:D`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[today(), action, moderator.tag, user?.tag || ""]]
    }
  });
}

async function getRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${EVENT_SHEET}!A2:J`
  });
  return res.data.values || [];
}

async function writeRows(rows) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${EVENT_SHEET}!A2:J`
  });

  if (rows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${EVENT_SHEET}!A2:J`,
      valueInputOption: "RAW",
      requestBody: { values: rows }
    });
  }
}

function formatEventBanMessage(row) {
  const [
    ,
    username,
    type,
    original,
    remaining,
    start,
    ,
    ,
    reason
  ] = row;

  return `${username} — ${original}-Event ${type} Ban Started ${start}
${remaining} Events Remaining
Reason: ${reason}`;
}

function formatProbationMessage(row) {
  const [
    ,
    username,
    ,
    days,
    ,
    start,
    end,
    ,
    reason
  ] = row;

  return `${username} — Probation Started ${start}
Ends: ${end} (${days} days)
Reason: ${reason}`;
}

// ================= COMMAND =================
const eventBanCommand = new SlashCommandBuilder()
  .setName("eventban")
  .setDescription("Event ban management")

  .addSubcommand(sub =>
    sub.setName("apply")
      .setDescription("Apply an event ban")
      .addUserOption(o =>
        o.setName("user").setDescription("User").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("type").setDescription("Ban type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addIntegerOption(o =>
        o.setName("events").setDescription("Number of events").setRequired(true)
          .setMinValue(1).setMaxValue(5)
      )
      .addStringOption(o =>
        o.setName("reason").setDescription("Reason").setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub.setName("probation")
      .setDescription("Apply a probation ban")
      .addUserOption(o =>
        o.setName("user").setDescription("User").setRequired(true)
      )
      .addIntegerOption(o =>
        o.setName("days").setDescription("Number of days").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("start")
          .setDescription("Start date YYYY-MM-DD")
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName("reason").setDescription("Reason").setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub.setName("eventpassed")
      .setDescription("Reduce remaining bans")
      .addStringOption(o =>
        o.setName("type").setDescription("Ban type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addIntegerOption(o =>
        o.setName("events").setDescription("Events passed").setRequired(true)
      )
  );

// ================= HANDLER =================
async function handleEventBan(interaction) {
  try {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply("No permission.");
    }

    if (interaction.channelId !== BAN_CHANNEL_ID) {
      return interaction.editReply("Wrong channel.");
    }

    const sub = interaction.options.getSubcommand();
    const rows = await getRows();
    const channel = await interaction.client.channels.fetch(BAN_CHANNEL_ID);

    // ===== EVENT BAN APPLY =====
    if (sub === "apply") {
      const user = interaction.options.getUser("user");
      const type = interaction.options.getString("type");
      const events = interaction.options.getInteger("events");
      const reason = interaction.options.getString("reason");

      const row = [
        user.id,
        user.username,
        type,
        events.toString(),
        events.toString(),
        today(),
        "",
        interaction.user.tag,
        reason,
        ""
      ];

      const msg = await channel.send(formatEventBanMessage(row));
      row[9] = msg.id;

      rows.push(row);
      await writeRows(rows);
      await logAudit("EVENT_BAN_APPLY", interaction.user, user);

      return interaction.editReply("Event ban applied.");
    }

    // ===== PROBATION =====
    if (sub === "probation") {
      const user = interaction.options.getUser("user");
      const days = interaction.options.getInteger("days");
      const startStr = interaction.options.getString("start");
      const reason = interaction.options.getString("reason");

      const endDate = addDays(startStr, days);

      const row = [
        user.id,
        user.username,
        "Probation",
        days.toString(),
        "",
        startStr,
        formatDate(endDate),
        interaction.user.tag,
        reason,
        ""
      ];

      const msg = await channel.send(formatProbationMessage(row));
      row[9] = msg.id;

      rows.push(row);
      await writeRows(rows);
      await logAudit("PROBATION_APPLY", interaction.user, user);

      return interaction.editReply("Probation applied.");
    }

    // ===== EVENT PASSED =====
    if (sub === "eventpassed") {
      const type = interaction.options.getString("type");
      const passed = interaction.options.getInteger("events");

      for (const row of rows) {
        if (row[2] === type && Number(row[4]) > 0) {
          row[4] = Math.max(0, Number(row[4]) - passed).toString();

          if (row[9]) {
            const msg = await channel.messages.fetch(row[9]);
            await msg.edit(formatEventBanMessage(row));
          }
        }
      }

      await writeRows(rows);
      await logAudit("EVENT_PASSED", interaction.user, null);

      await channel.send(
        `Remaining ${type} Events reduced by ${passed} — actioned by ${interaction.user.tag}`
      );

      return interaction.editReply("Event bans updated.");
    }

  } catch (err) {
    console.error(err);
    return interaction.editReply("An error occurred.");
  }
}

// ================= EXPORTS =================
module.exports = {
  eventBanCommand,
  handleEventBan
};
