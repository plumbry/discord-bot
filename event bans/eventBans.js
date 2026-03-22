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

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  const uk = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

  let match;

  if ((match = str.match(iso))) {
    const [, y, m, d] = match;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  if ((match = str.match(uk))) {
    const [, d, m, y] = match;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  return null;
}

async function logAudit(action, moderator, user = "") {
  try {
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
  } catch (err) {
    console.error("AUDIT LOG ERROR:", err);
  }
}

async function getRows() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${EVENT_SHEET}!A2:J`
    });

    return res.data.values || [];
  } catch (err) {
    console.error("GET ROWS ERROR:", err);
    return [];
  }
}

async function writeRows(rows) {
  try {
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
  } catch (err) {
    console.error("WRITE ROWS ERROR:", err);
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
      o.setName("events").setDescription("Events").setRequired(true))
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true))
)

.addSubcommand(s =>
  s.setName("probation")
    .setDescription("Apply probation (days)")
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption(o =>
      o.setName("days").setDescription("Days").setRequired(true))
    .addStringOption(o =>
      o.setName("reason").setDescription("Reason").setRequired(true))
    .addStringOption(o =>
      o.setName("start")
        .setDescription("Start date YYYY-MM-DD or DD/MM/YYYY")
        .setRequired(false))
)

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

.addSubcommand(s =>
  s.setName("summary")
    .setDescription("Show active bans and probations")
);

// ================= HANDLER =================

async function handleEventBan(interaction) {

  try {

    await interaction.deferReply();

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply("No permission.");
    }

    const sub = interaction.options.getSubcommand();
    const rows = await getRows();

    let banChannel;
    try {
      banChannel = await interaction.guild.channels.fetch(BAN_CHANNEL_ID);
      if (!banChannel) throw new Error("Channel not found");
    } catch (err) {
      console.error("BAN CHANNEL ERROR:", err);
      return interaction.editReply("Ban channel not accessible.");
    }

    // ===== APPLY =====
    if (sub === "apply") {

      const user = interaction.options.getUser("user");
      const type = interaction.options.getString("type");
      const events = interaction.options.getInteger("events");
      const reason = interaction.options.getString("reason");

      if (!user || !type || !events) {
        return interaction.editReply("Invalid input.");
      }

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

      let msg;
      try {
        msg = await banChannel.send(formatEventBan(row));
      } catch (err) {
        console.error("SEND ERROR:", err);
        return interaction.editReply("Failed to send message.");
      }

      row[9] = msg.id;

      rows.push(row);

      await writeRows(rows);
      await logAudit(`Applied ${events}-event ${type} ban`, interaction.user, user);

      return interaction.editReply("✅ Event ban applied.");
    }

    // ===== PROBATION =====
    if (sub === "probation") {

      const user = interaction.options.getUser("user");
      const days = interaction.options.getInteger("days");
      const reason = interaction.options.getString("reason");
      const startInput = interaction.options.getString("start");

      if (!user || !days) {
        return interaction.editReply("Invalid input.");
      }

      let startDate = startInput ? parseDateInput(startInput) : new Date();

      if (startInput && !startDate) {
        return interaction.editReply("Invalid date format.");
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

      let msg;
      try {
        msg = await banChannel.send(formatProbation(row));
      } catch (err) {
        console.error("SEND ERROR:", err);
        return interaction.editReply("Failed to send message.");
      }

      row[9] = msg.id;

      rows.push(row);

      await writeRows(rows);
      await logAudit(`Applied ${days}-day probation`, interaction.user, user);

      return interaction.editReply("✅ Probation applied.");
    }

    // ===== EVENT PASSED =====
    if (sub === "eventpassed") {

      const type = interaction.options.getString("type");
      const events = interaction.options.getInteger("events");

      if (!type || !events) {
        return interaction.editReply("Invalid input.");
      }

      const typeLower = type.toLowerCase();

      for (const r of rows) {

        if (r[2] === "Probation") continue;

        const rowType = (r[2] || "").toLowerCase();

        if ((typeLower === "all" || rowType === typeLower) && Number(r[4]) > 0) {

          r[4] = Math.max(0, Number(r[4]) - events);
          r[6] = today();

          if (r[9]) {
            try {
              const msg = await banChannel.messages.fetch(r[9]);
              await msg.edit(formatEventBan(r));
            } catch (err) {
              console.error("MESSAGE EDIT ERROR:", err);
            }
          }
        }
      }

      await writeRows(rows);

      return interaction.editReply("✅ Event bans updated.");
    }

    // ===== SUMMARY =====
    if (sub === "summary") {

      const activeBans = rows.filter(
        r => r[2] !== "Probation" && Number(r[4]) > 0
      );

      const probations = rows.filter(
        r => r[2] === "Probation" && Number(r[4]) > 0
      );

      let text = "**Active Event Bans**\n";

      text += activeBans.length
        ? activeBans.map(r =>
          `${r[1]} — ${r[2]} | ${r[4]} events remaining`
        ).join("\n")
        : "None";

      text += "\n\n**Active Probations**\n";

      text += probations.length
        ? probations.map(r =>
          `${r[1]} — ${r[4]} days remaining (ends ${r[6]})`
        ).join("\n")
        : "None";

      return interaction.editReply(text);
    }

  } catch (error) {

    console.error("HANDLE EVENT BAN FATAL ERROR:", error);

    try {
      return interaction.editReply("Something went wrong.");
    } catch {
      return;
    }

  }

}

module.exports = {
  eventBanCommand,
  handleEventBan
};