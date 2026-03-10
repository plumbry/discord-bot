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
        .setDescription("Reason")
        .setRequired(true))
)

.addSubcommand(s =>
  s.setName("eventpassed")
    .setDescription("Reduce remaining bans")
    .addStringOption(o =>
      o.setName("type")
        .setDescription("Event type")
        .setRequired(true))
    .addIntegerOption(o =>
      o.setName("events")
        .setDescription("Events passed")
        .setRequired(true))
)

.addSubcommand(s =>
  s.setName("removelast")
    .setDescription("Remove most recent ban")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true))
)

.addSubcommand(s =>
  s.setName("summary")
    .setDescription("Show active bans and probations")
);

// ================= MAIN HANDLER =================
async function handleEventBan(interaction) {

  await interaction.deferReply();

  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
    return interaction.editReply("No permission.");

  const sub = interaction.options.getSubcommand();
  const rows = await getRows();
  const banChannel = await interaction.guild.channels.fetch(BAN_CHANNEL_ID);

  // ================= APPLY BAN =================
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

  // ================= EVENT PASSED =================
  if (sub === "eventpassed") {

    const type = interaction.options.getString("type");
    const events = interaction.options.getInteger("events");

    for (const r of rows) {

      if (r[2] === type && Number(r[4]) > 0) {

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

    await logAudit(`Event passed (${events})`, interaction.user);

    return interaction.editReply("✅ Event bans updated.");
  }

  // ================= REMOVE LAST =================
  if (sub === "removelast") {

    const user = interaction.options.getUser("user");

    const index = [...rows]
      .map((r,i)=>({r,i}))
      .reverse()
      .find(x=>x.r[0]===user.id);

    if (!index)
      return interaction.editReply("No bans found.");

    const removed = rows.splice(index.i,1)[0];

    if (removed[9]) {
      try {
        const msg = await banChannel.messages.fetch(removed[9]);
        await msg.delete();
      } catch {}
    }

    await writeRows(rows);

    await logAudit("Removed last ban", interaction.user, user);

    return interaction.editReply("🗑️ Last ban removed.");
  }

  // ================= SUMMARY =================
  if (sub === "summary") {

    const activeBans = rows.filter(r => r[2] !== "Probation" && Number(r[4]) > 0);
    const probations = rows.filter(r => r[2] === "Probation");

    let text = "";

    text += "**Active Event Bans**\n";

    if (!activeBans.length)
      text += "None\n";
    else
      text += activeBans
        .map(r => `${r[1]} — ${r[2]} | ${r[4]} events remaining`)
        .join("\n");

    text += "\n\n**Active Probations**\n";

    if (!probations.length)
      text += "None";
    else
      text += probations
        .map(r => `${r[1]} — ends ${r[6]}`)
        .join("\n");

    return interaction.editReply(text);
  }

}

module.exports = {
  eventBanCommand,
  handleEventBan
};