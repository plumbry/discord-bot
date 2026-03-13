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
      o.setName("user").setDescription("User").setRequired(true))
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
        .setDescription("Reason")
        .setRequired(true))
)

// PROBATION
.addSubcommand(s =>
  s.setName("probation")
    .setDescription("Apply probation (days)")
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption(o =>
      o.setName("days").setDescription("Days").setRequired(true))
    .addStringOption(o =>
      o.setName("start")
        .setDescription("Start date DD/MM/YYYY")
        .setRequired(false))
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true))
)

// EVENT PASSED
.addSubcommand(s =>
  s.setName("eventpassed")
    .setDescription("Reduce remaining bans")
    .addStringOption(o =>
      o.setName("type")
        .setDescription("Event type")
        .setRequired(true)
        .addChoices(
          { name: "Money", value: "Money" },
          { name: "No Money", value: "No Money" },
          { name: "All", value: "All" }
        ))
    .addIntegerOption(o =>
      o.setName("events")
        .setDescription("Events passed")
        .setRequired(true))
)

// REMOVE LAST
.addSubcommand(s =>
  s.setName("removelast")
    .setDescription("Remove most recent ban")
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(true))
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

  // EVENT BAN

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

  // PROBATION

  if (sub === "probation") {

    const user = interaction.options.getUser("user");
    const days = interaction.options.getInteger("days");
    const startInput = interaction.options.getString("start");
    const reason = interaction.options.getString("reason");

    let startDate;

    if (startInput) {

      const [d,m,y] = startInput.split("/").map(Number);
      startDate = new Date(y, m - 1, d);

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

  // EVENT PASSED

  if (sub === "eventpassed") {

    const type = interaction.options.getString("type").toLowerCase();
    const events = interaction.options.getInteger("events");

    for (const r of rows) {

      if (r[2] === "Probation") continue;

      const rowType = r[2].toLowerCase();

      if ((type === "all" || rowType === type) && Number(r[4]) > 0) {

        r[4] = Math.max(0, Number(r[4]) - events);
        r[6] = today();

        if (r[9]) {

          try {

            const msg = await banChannel.messages.fetch(r[9]);
            await msg.edit(formatEventBan(r));

          } catch {}

        }

      }

    }

    await writeRows(rows);

    return interaction.editReply("✅ Event bans updated.");
  }

  // SUMMARY

  if (sub === "summary") {

    const activeBans = rows.filter(r => r[2] !== "Probation" && Number(r[4]) > 0);
    const probations = rows.filter(r => r[2] === "Probation" && Number(r[4]) > 0);

    let text = "**Active Event Bans**\n";

    text += activeBans.length
      ? activeBans.map(r => `${r[1]} — ${r[4]} events remaining`).join("\n")
      : "None";

    text += "\n\n**Active Probations**\n";

    text += probations.length
      ? probations.map(r => `${r[1]} — ${r[4]} days remaining`).join("\n")
      : "None";

    return interaction.editReply(text);
  }

}

module.exports = {
  eventBanCommand,
  handleEventBan
};