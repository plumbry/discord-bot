const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");
const { google } = require("googleapis");

// ================= CONFIG =================
const SHEET_ID = "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM";
const EVENT_SHEET = "Event Bans";
const AUDIT_SHEET = "Audit Log";
const BAN_CHANNEL_ID = "1472795189515915466";

// ================= GOOGLE AUTH =================
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

// ================= HELPERS =================
const today = () => new Date().toLocaleDateString("en-GB");

function probationExpired(endDateStr) {
  if (!endDateStr) return false;

  const [day, month, year] = endDateStr.split("/").map(Number);
  const end = new Date(year, month - 1, day);

  const now = new Date();
  now.setHours(0,0,0,0);

  return end < now;
}

async function logAudit(action, moderator, user = "") {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${AUDIT_SHEET}!A2:D`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        today(),
        action,
        moderator.tag,
        user?.tag || user
      ]]
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

// ================= FORMATTERS =================
const formatEventBan = r =>
`${r[1]} — ${r[3]}-Event ${r[2]} Ban Started ${r[5]}
${r[4]} Events Remaining
Reason: ${r[7] || "No reason provided"}`;

const formatProbation = r =>
`${r[1]} — Probation Started ${r[5]}
Ends: ${r[6]} (${r[3]} days)
Reason: ${r[7] || "No reason provided"}`;

// ================= COMMAND BUILDERS =================
const eventBanCommand = new SlashCommandBuilder()
  .setName("eventban")
  .setDescription("Event ban management")

  .addSubcommand(s =>
    s.setName("apply")
      .setDescription("Apply an event ban")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
      .addStringOption(o =>
        o.setName("type").setDescription("Type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" },
            { name: "All", value: "All" }
          ))
      .addIntegerOption(o =>
        o.setName("events").setDescription("Events").setRequired(true)
          .setMinValue(1).setMaxValue(5))
      .addStringOption(o =>
        o.setName("reason").setDescription("Reason").setRequired(true))
  )

  .addSubcommand(s =>
    s.setName("summary")
      .setDescription("View summary of active event bans")
  );

const recentBanCommand = new SlashCommandBuilder()
  .setName("recentban")
  .setDescription("View a user's most recent event ban")
  .addUserOption(o => o.setName("user").setDescription("User").setRequired(true));

const myBanCommand = new SlashCommandBuilder()
  .setName("myban")
  .setDescription("View your current event bans");

// ================= HANDLER =================
async function handleEventBan(interaction) {
  try {

    await interaction.deferReply({ ephemeral: false });

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return interaction.editReply("No permission.");

    if (interaction.channelId !== BAN_CHANNEL_ID)
      return interaction.editReply("Wrong channel.");

    const sub = interaction.options.getSubcommand();
    const rows = await getRows();

    // ===== APPLY =====
    if (sub === "apply") {

      const user = interaction.options.getUser("user");
      const type = interaction.options.getString("type");
      const events = interaction.options.getInteger("events");
      const reason = interaction.options.getString("reason");

      const newRow = [
        user.id,
        user.tag,
        type,
        events,
        events,
        today(),
        "",
        reason
      ];

      rows.push(newRow);

      await writeRows(rows);

      await logAudit(
        `Applied ${events}-event ${type} ban`,
        interaction.user,
        user
      );

      return interaction.editReply(
        `✅ Event ban applied\n\n${formatEventBan(newRow)}`
      );
    }

    // ===== SUMMARY =====
    if (sub === "summary") {

      const activeEvents = rows.filter(
        r => r[2] !== "Probation" && Number(r[4]) > 0
      );

      const probations = rows.filter(
        r => r[2] === "Probation" && !probationExpired(r[6])
      );

      return interaction.editReply(
        `📊 **Event Ban Summary**\n\n` +
        `Active Event Bans: **${activeEvents.length}**\n` +
        `Active Probations: **${probations.length}**`
      );
    }

  } catch (e) {
    console.error(e);
    return interaction.editReply("An error occurred.");
  }
}

// ================= OTHER HANDLERS =================
async function handleRecentBan(interaction) {

  await interaction.deferReply();

  const u = interaction.options.getUser("user");
  const rows = await getRows();

  const r = [...rows].reverse().find(x =>
    x[0] === u.id &&
    (x[2] !== "Probation" || !probationExpired(x[6]))
  );

  if (!r) return interaction.editReply("No bans found.");

  return interaction.editReply(
    r[2] === "Probation" ? formatProbation(r) : formatEventBan(r)
  );
}

async function handleMyBan(interaction) {

  const rows = await getRows();

  const mine = rows.filter(r =>
    r[0] === interaction.user.id &&
    (
      (r[2] !== "Probation" && r[4] !== "0") ||
      (r[2] === "Probation" && !probationExpired(r[6]))
    )
  );

  if (!mine.length)
    return interaction.editReply("You have no active bans.");

  return interaction.editReply(
    mine.map(r =>
      r[2] === "Probation"
        ? formatProbation(r)
        : formatEventBan(r)
    ).join("\n\n")
  );
}

// ================= EXPORTS =================
module.exports = {
  eventBanCommand,
  recentBanCommand,
  myBanCommand,
  handleEventBan,
  handleRecentBan,
  handleMyBan
};