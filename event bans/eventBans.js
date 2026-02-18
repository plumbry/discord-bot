const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { google } = require("googleapis");

// ================= CONFIG =================
const SHEET_ID = "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM";
const EVENT_SHEET = "Event Bans";
const AUDIT_SHEET = "Audit Log";
const BAN_CHANNEL_ID = "1472795189515915466";

// ================= GOOGLE AUTH =================
let credentials;

try {
  const decoded = Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8");
  credentials = JSON.parse(decoded);
} catch {
  credentials = {};
}

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// ================= SLASH COMMAND =================
const eventBanCommand = new SlashCommandBuilder()
  .setName("eventban")
  .setDescription("Manage event and probation bans")

  // APPLY EVENT BAN
  .addSubcommand(sub =>
    sub.setName("apply")
      .setDescription("Apply an event ban")
      .addUserOption(o => o.setName("user").setDescription("Player").setRequired(true))
      .addStringOption(o =>
        o.setName("type").setDescription("Ban type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addStringOption(o =>
        o.setName("events").setDescription("Number of events").setRequired(true)
          .addChoices(
            { name: "1 Event", value: "1" },
            { name: "2 Events", value: "2" },
            { name: "5 Events", value: "5" }
          )
      )
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true))
  )

  // EVENT PASSED
  .addSubcommand(sub =>
    sub.setName("eventpassed")
      .setDescription("Reduce all bans of a type by X events")
      .addStringOption(o =>
        o.setName("type").setDescription("Ban type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addIntegerOption(o =>
        o.setName("events").setDescription("Events passed").setRequired(true).setMinValue(1).setMaxValue(10)
      )
  )

  // PROBATION
  .addSubcommand(sub =>
    sub.setName("probation")
      .setDescription("Apply a time-based probation ban")
      .addUserOption(o => o.setName("user").setDescription("Player").setRequired(true))
      .addIntegerOption(o =>
        o.setName("days").setDescription("Length in days").setRequired(true).setMinValue(1).setMaxValue(365)
      )
      .addStringOption(o =>
        o.setName("start").setDescription("Start date (DD/MM/YYYY)").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("reason").setDescription("Reason").setRequired(true)
      )
  )

  // REMOVE LAST
  .addSubcommand(sub =>
    sub.setName("removelast")
      .setDescription("Remove most recent ban")
      .addUserOption(o => o.setName("user").setDescription("Player").setRequired(true))
  );

// ================= HELPERS =================
function formatDate(date) {
  return date.toLocaleDateString("en-GB");
}

async function getRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${EVENT_SHEET}!A2:J`
  });
  return res.data.values || [];
}

async function overwriteSheet(rows) {
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

async function logAudit(action, moderatorTag, userTag = "") {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${AUDIT_SHEET}!A2:D`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        formatDate(new Date()),
        action,
        moderatorTag,
        userTag
      ]]
    }
  });
}

// ================= HANDLER =================
async function handleEventBan(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply("❌ You do not have permission.");
  }

  if (interaction.channelId !== BAN_CHANNEL_ID) {
    return interaction.editReply("❌ Wrong channel.");
  }

  const sub = interaction.options.getSubcommand();
  const moderator = interaction.user;
  const today = formatDate(new Date());

  // APPLY EVENT BAN
  if (sub === "apply") {
    const user = interaction.options.getUser("user");
    const type = interaction.options.getString("type");
    const events = parseInt(interaction.options.getString("events"), 10);
    const reason = interaction.options.getString("reason");

    const channel = await interaction.client.channels.fetch(BAN_CHANNEL_ID);
    await channel.send(
      `${user.tag} — ${events}-Event ${type} Ban Started ${today}\n` +
      `${events} Events Remaining\nReason: ${reason}`
    );

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${EVENT_SHEET}!A2:J`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          user.id, user.tag, type,
          events, events,
          today, today,
          reason, moderator.tag,
          "EVENT"
        ]]
      }
    });

    await logAudit("EVENT_BAN_APPLY", moderator.tag, user.tag);
    return interaction.editReply("✅ Event ban applied.");
  }

  // EVENT PASSED
  if (sub === "eventpassed") {
    const type = interaction.options.getString("type");
    const passed = interaction.options.getInteger("events");
    const rows = await getRows();

    for (const row of rows) {
      if (row[2] === type && row[4] && Number(row[4]) > 0) {
        row[4] = Math.max(0, Number(row[4]) - passed).toString();
      }
    }

    await overwriteSheet(rows);

    const channel = await interaction.client.channels.fetch(BAN_CHANNEL_ID);
    await channel.send(
      `Remaining ${type} Events reduced by ${passed} — actioned by ${moderator.tag}`
    );

    await logAudit(
      `EVENT_PASSED_${type.toUpperCase().replace(" ", "_")}`,
      moderator.tag
    );

    return interaction.editReply("✅ Event bans updated.");
  }

  // PROBATION
  if (sub === "probation") {
    const user = interaction.options.getUser("user");
    const days = interaction.options.getInteger("days");
    const start = interaction.options.getString("start");
    const reason = interaction.options.getString("reason");

    const [d, m, y] = start.split("/").map(Number);
    const startDate = new Date(y, m - 1, d);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days);

    const channel = await interaction.client.channels.fetch(BAN_CHANNEL_ID);
    await channel.send(
      `${user.tag} — **Probation Started** ${formatDate(startDate)}\n` +
      `Ends: ${formatDate(endDate)} (${days} days)\n` +
      `Reason: ${reason}`
    );

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${EVENT_SHEET}!A2:J`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          user.id, user.tag,
          "Probation", days, "",
          formatDate(startDate), formatDate(endDate),
          reason, moderator.tag,
          "PROBATION"
        ]]
      }
    });

    await logAudit("PROBATION_APPLY", moderator.tag, user.tag);
    return interaction.editReply("✅ Probation ban applied.");
  }

  // REMOVE LAST
  if (sub === "removelast") {
    const user = interaction.options.getUser("user");
    const rows = await getRows();

    const idx = [...rows].map((r, i) => ({ r, i }))
      .reverse()
      .find(x => x.r[0] === user.id);

    if (!idx) return interaction.editReply("No bans found.");

    rows.splice(idx.i, 1);
    await overwriteSheet(rows);

    await logAudit("REMOVE_LAST_BAN", moderator.tag, user.tag);
    return interaction.editReply("✅ Last ban removed.");
  }
}

module.exports = {
  eventBanCommand,
  handleEventBan
};
