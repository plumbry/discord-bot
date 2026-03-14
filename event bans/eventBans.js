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

function parseDateInput(str) {

  if (!str) return null;

  str = str.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

  let match;

  if (match = str.match(iso)) {
    const [,y,m,d] = match;
    return new Date(Number(y), Number(m)-1, Number(d));
  }

  if (match = str.match(uk)) {
    const [,d,m,y] = match;
    return new Date(Number(y), Number(m)-1, Number(d));
  }

  return null;
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
`${r[1]} — Probation
Started ${r[5]}
Ends ${r[6]}
${r[4]} Days Remaining
Reason: ${r[7] || "No reason provided"}`;

// ================= COMMAND =================

const eventBanCommand = new SlashCommandBuilder()
.setName("eventban")
.setDescription("Event ban management")

// EVENT BAN
.addSubcommand(s =>
  s.setName("apply")
    .setDescription("Apply an event ban")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User to ban")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("type")
        .setDescription("Ban type")
        .setRequired(true)
        .addChoices(
          { name: "Money", value: "Money" },
          { name: "No Money", value: "No Money" },
          { name: "All", value: "All" }
        ))
    .addIntegerOption(o =>
      o.setName("events")
        .setDescription("Number of events")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason for the ban")
        .setRequired(true))
)

// PROBATION
.addSubcommand(s =>
  s.setName("probation")
    .setDescription("Apply probation (days)")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User to place on probation")
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("days")
        .setDescription("Number of probation days")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason for probation")
        .setRequired(true))
    .addStringOption(o =>
      o.setName("start")
        .setDescription("Start date YYYY-MM-DD or DD/MM/YYYY")
        .setRequired(false))
)

// SUMMARY
.addSubcommand(s =>
  s.setName("summary")
    .setDescription("Show active bans and probations")
);

// ================= HANDLER =================

async function handleEventBan(interaction) {

  await interaction.deferReply();

  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
    return interaction.editReply("No permission.");

  const sub = interaction.options.getSubcommand();
  const rows = await getRows();
  const banChannel = await interaction.guild.channels.fetch(BAN_CHANNEL_ID);

  // ================= EVENT BAN =================

  if (sub === "apply") {

    const user = interaction.options.getUser("user");
    const type = interaction.options.getString("type");
    const events = interaction.options.getInteger("events");
    const reason = interaction.options.getString("reason");

    const row = [
      user.id,
      user.tag,
      type,
      events,
      events,
      today(),
      today(),
      reason,
      interaction.user.tag,
      ""
    ];

    const msg = await banChannel.send(formatEventBan(row));

    row[9] = msg.id;

    rows.push(row);

    await writeRows(rows);

    await logAudit(`Applied ${events}-event ${type} ban`, interaction.user, user);

    return interaction.editReply("✅ Event ban applied.");
  }

  // ================= PROBATION =================

  if (sub === "probation") {

    const user = interaction.options.getUser("user");
    const days = interaction.options.getInteger("days");
    const reason = interaction.options.getString("reason");
    const startInput = interaction.options.getString("start");

    let startDate;

    if (startInput) {

      startDate = parseDateInput(startInput);

      if (!startDate)
        return interaction.editReply(
          "Invalid date format. Use **YYYY-MM-DD** or **DD/MM/YYYY**."
        );

    } else {

      startDate = new Date();

    }

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days);

    const format = d => d.toLocaleDateString("en-GB");

    const row = [
      user.id,
      user.tag,
      "Probation",
      days,
      days,
      format(startDate),
      format(endDate),
      reason,
      interaction.user.tag,
      ""
    ];

    const msg = await banChannel.send(formatProbation(row));

    row[9] = msg.id;

    rows.push(row);

    await writeRows(rows);

    await logAudit(`Applied ${days}-day probation`, interaction.user, user);

    return interaction.editReply("✅ Probation applied.");
  }

  // ================= SUMMARY =================

  if (sub === "summary") {

    const activeBans = rows.filter(r => r[2] !== "Probation" && Number(r[4]) > 0);
    const probations = rows.filter(r => r[2] === "Probation" && Number(r[4]) > 0);

    let text = "**Active Event Bans**\n";

    text += activeBans.length
      ? activeBans.map(r => `${r[1]} — ${r[4]} events remaining`).join("\n")
      : "None";

    text += "\n\n**Active Probations**\n";

    text += probations.length
      ? probations.map(r => `${r[1]} — ${r[4]} days remaining (ends ${r[6]})`).join("\n")
      : "None";

    return interaction.editReply(text);
  }

}

module.exports = {
  eventBanCommand,
  handleEventBan
};