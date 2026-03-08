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

const parseDDMMYYYY = (str) => {
  const [dd, mm, yyyy] = str.split("-").map(Number);
  if (!dd || !mm || !yyyy) return null;

  const d = new Date(yyyy, mm - 1, dd);
  if (
    d.getDate() !== dd ||
    d.getMonth() !== mm - 1 ||
    d.getFullYear() !== yyyy
  ) return null;

  return d;
};

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

// ================= COMMAND BUILDER =================
const eventBanCommand = new SlashCommandBuilder()
  .setName("eventban")
  .setDescription("Event ban management")

  .addSubcommand(s =>
    s.setName("apply")
      .setDescription("Apply an event ban")
      .addUserOption(o => o.setName("user").setRequired(true))
      .addStringOption(o =>
        o.setName("type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" },
            { name: "All", value: "All" }
          ))
      .addIntegerOption(o =>
        o.setName("events").setRequired(true).setMinValue(1).setMaxValue(5))
      .addStringOption(o => o.setName("reason").setRequired(true))
  )

  .addSubcommand(s =>
    s.setName("probation")
      .setDescription("Apply probation")
      .addUserOption(o => o.setName("user").setRequired(true))
      .addIntegerOption(o => o.setName("days").setRequired(true))
      .addStringOption(o => o.setName("start").setRequired(true))
      .addStringOption(o => o.setName("reason").setRequired(true))
  )

  .addSubcommand(s =>
    s.setName("eventpassed")
      .setDescription("Reduce remaining bans")
      .addStringOption(o =>
        o.setName("type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" },
            { name: "All", value: "All" }
          ))
      .addIntegerOption(o => o.setName("events").setRequired(true))
  )

  .addSubcommand(s =>
    s.setName("removelast")
      .setDescription("Remove last ban")
      .addUserOption(o => o.setName("user").setRequired(true))
  )

  .addSubcommand(s =>
    s.setName("summary")
      .setDescription("View active bans summary")
  )

  .addSubcommand(s =>
    s.setName("history")
      .setDescription("View ban history")
      .addUserOption(o => o.setName("user").setRequired(true))
  );

const recentBanCommand = new SlashCommandBuilder()
  .setName("recentban")
  .setDescription("View most recent ban")
  .addUserOption(o => o.setName("user").setRequired(true));

const myBanCommand = new SlashCommandBuilder()
  .setName("myban")
  .setDescription("View your bans");

// ================= MAIN HANDLER =================
async function handleEventBan(interaction) {

  await interaction.deferReply();

  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
    return interaction.editReply("No permission.");

  if (interaction.channelId !== BAN_CHANNEL_ID)
    return interaction.editReply("Wrong channel.");

  const sub = interaction.options.getSubcommand();
  const rows = await getRows();

  // APPLY
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
      "",
      reason
    ];

    rows.push(row);

    await writeRows(rows);
    await logAudit(`Applied ${events}-event ${type} ban`, interaction.user, user);

    return interaction.editReply(`✅ Ban applied\n\n${formatEventBan(row)}`);
  }

  // PROBATION
  if (sub === "probation") {

    const user = interaction.options.getUser("user");
    const days = interaction.options.getInteger("days");
    const start = interaction.options.getString("start");
    const reason = interaction.options.getString("reason");

    const startDate = parseDDMMYYYY(start);

    if (!startDate)
      return interaction.editReply("Invalid date. Use DD-MM-YYYY.");

    const end = new Date(startDate);
    end.setDate(end.getDate() + days);

    const endStr = end.toLocaleDateString("en-GB");

    const row = [
      user.id,
      user.tag,
      "Probation",
      days,
      "",
      startDate.toLocaleDateString("en-GB"),
      endStr,
      reason
    ];

    rows.push(row);

    await writeRows(rows);
    await logAudit("Applied probation", interaction.user, user);

    return interaction.editReply(`⚠️ Probation applied\n\n${formatProbation(row)}`);
  }

  // EVENT PASSED
  if (sub === "eventpassed") {

    const type = interaction.options.getString("type");
    const events = interaction.options.getInteger("events");

    for (const r of rows) {
      if (r[2] === type && Number(r[4]) > 0) {
        r[4] = Math.max(0, Number(r[4]) - events);
      }
    }

    await writeRows(rows);
    await logAudit(`Event passed (${events})`, interaction.user);

    return interaction.editReply("✅ Event bans updated.");
  }

  // REMOVE LAST
  if (sub === "removelast") {

    const user = interaction.options.getUser("user");

    const index = [...rows]
      .map((r, i) => ({ r, i }))
      .reverse()
      .find(x => x.r[0] === user.id);

    if (!index)
      return interaction.editReply("No bans found.");

    const removed = rows.splice(index.i, 1)[0];

    await writeRows(rows);
    await logAudit("Removed last ban", interaction.user, user);

    return interaction.editReply(
      `🗑️ Removed last ban\n\n${
        removed[2] === "Probation"
          ? formatProbation(removed)
          : formatEventBan(removed)
      }`
    );
  }

  // SUMMARY
  if (sub === "summary") {

    const activeEvents = rows.filter(r => r[2] !== "Probation" && Number(r[4]) > 0);
    const probations = rows.filter(r => r[2] === "Probation" && !probationExpired(r[6]));

    return interaction.editReply(
      `📊 Event Ban Summary\n\nActive Event Bans: **${activeEvents.length}**\nActive Probations: **${probations.length}**`
    );
  }

  // HISTORY
  if (sub === "history") {

    const user = interaction.options.getUser("user");

    const history = rows.filter(r => r[0] === user.id);

    if (!history.length)
      return interaction.editReply("No history found.");

    return interaction.editReply(
      history.map(r =>
        r[2] === "Probation"
          ? formatProbation(r)
          : formatEventBan(r)
      ).join("\n\n")
    );
  }

}

// ================= OTHER COMMANDS =================
async function handleRecentBan(interaction) {

  await interaction.deferReply();

  const user = interaction.options.getUser("user");
  const rows = await getRows();

  const r = [...rows].reverse().find(x => x[0] === user.id);

  if (!r) return interaction.editReply("No bans found.");

  return interaction.editReply(
    r[2] === "Probation"
      ? formatProbation(r)
      : formatEventBan(r)
  );
}

async function handleMyBan(interaction) {

  const rows = await getRows();

  const mine = rows.filter(r => r[0] === interaction.user.id);

  if (!mine.length)
    return interaction.editReply("You have no bans.");

  return interaction.editReply(
    mine.map(r =>
      r[2] === "Probation"
        ? formatProbation(r)
        : formatEventBan(r)
    ).join("\n\n")
  );
}

module.exports = {
  eventBanCommand,
  recentBanCommand,
  myBanCommand,
  handleEventBan,
  handleRecentBan,
  handleMyBan
};