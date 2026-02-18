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
  Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64")
    .toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// ================= HELPERS =================
const formatDate = d => d.toLocaleDateString("en-GB");

const addDays = (start, days) => {
  const d = new Date(start);
  d.setDate(d.getDate() + days);
  return d;
};

async function logAudit(action, moderator, user = "") {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${AUDIT_SHEET}!A2:D`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[formatDate(new Date()), action, moderator.tag, user?.tag || user]]
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

// ================= MESSAGE FORMATTERS =================
const formatEventBan = row =>
`${row[1]} — ${row[3]}-Event ${row[2]} Ban Started ${row[5]}
${row[4]} Events Remaining
Reason: ${row[8]}`;

const formatProbation = row =>
`${row[1]} — Probation Started ${row[5]}
Ends: ${row[6]} (${row[3]} days)
Reason: ${row[8]}`;

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
            { name: "No Money", value: "No Money" }
          ))
      .addIntegerOption(o =>
        o.setName("events").setDescription("Events").setRequired(true).setMinValue(1).setMaxValue(5))
      .addStringOption(o =>
        o.setName("reason").setDescription("Reason").setRequired(true))
  )

  .addSubcommand(s =>
    s.setName("probation")
      .setDescription("Apply a probation ban")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
      .addIntegerOption(o => o.setName("days").setDescription("Days").setRequired(true))
      .addStringOption(o => o.setName("start").setDescription("YYYY-MM-DD").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true))
  )

  .addSubcommand(s =>
    s.setName("eventpassed")
      .setDescription("Reduce remaining bans")
      .addStringOption(o =>
        o.setName("type").setDescription("Type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          ))
      .addIntegerOption(o => o.setName("events").setDescription("Events passed").setRequired(true))
  )

  .addSubcommand(s =>
    s.setName("removelast")
      .setDescription("Remove last ban")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
  );

const recentBanCommand = new SlashCommandBuilder()
  .setName("recentban")
  .setDescription("View a user's most recent event ban")
  .addUserOption(o => o.setName("user").setDescription("User").setRequired(true));

const myBanCommand = new SlashCommandBuilder()
  .setName("myban")
  .setDescription("View your current event bans");

// ================= HANDLERS =================
async function handleEventBan(interaction) {
  try {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return interaction.editReply("No permission.");

    if (interaction.channelId !== BAN_CHANNEL_ID)
      return interaction.editReply("Wrong channel.");

    const sub = interaction.options.getSubcommand();
    const rows = await getRows();
    const channel = await interaction.client.channels.fetch(BAN_CHANNEL_ID);

    // APPLY
    if (sub === "apply") {
      const u = interaction.options.getUser("user");
      const type = interaction.options.getString("type");
      const events = interaction.options.getInteger("events");
      const reason = interaction.options.getString("reason");

      const row = [
        u.id, u.username, type,
        events.toString(), events.toString(),
        formatDate(new Date()), "", interaction.user.tag, reason, ""
      ];

      const msg = await channel.send(formatEventBan(row));
      row[9] = msg.id;

      rows.push(row);
      await writeRows(rows);
      await logAudit("EVENT_BAN_APPLY", interaction.user, u);

      return interaction.editReply("Event ban applied.");
    }

    // PROBATION
    if (sub === "probation") {
      const u = interaction.options.getUser("user");
      const days = interaction.options.getInteger("days");
      const start = interaction.options.getString("start");
      const reason = interaction.options.getString("reason");

      const end = formatDate(addDays(start, days));

      const row = [
        u.id, u.username, "Probation",
        days.toString(), "", start, end,
        interaction.user.tag, reason, ""
      ];

      const msg = await channel.send(formatProbation(row));
      row[9] = msg.id;

      rows.push(row);
      await writeRows(rows);
      await logAudit("PROBATION_APPLY", interaction.user, u);

      return interaction.editReply("Probation applied.");
    }

    // EVENT PASSED
    if (sub === "eventpassed") {
      const type = interaction.options.getString("type");
      const passed = interaction.options.getInteger("events");

      for (const r of rows) {
        if (r[2] === type && Number(r[4]) > 0) {
          r[4] = Math.max(0, Number(r[4]) - passed).toString();
          if (r[9]) {
            const m = await channel.messages.fetch(r[9]);
            await m.edit(formatEventBan(r));
          }
        }
      }

      await writeRows(rows);
      await logAudit("EVENT_PASSED", interaction.user);

      await channel.send(
        `Remaining ${type} Events reduced by ${passed} — actioned by ${interaction.user.tag}`
      );

      return interaction.editReply("Event bans updated.");
    }

    // REMOVE LAST
    if (sub === "removelast") {
      const u = interaction.options.getUser("user");

      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i][0] === u.id) {
          if (rows[i][9]) {
            const m = await channel.messages.fetch(rows[i][9]);
            await m.delete().catch(() => {});
          }
          rows.splice(i, 1);
          break;
        }
      }

      await writeRows(rows);
      await logAudit("REMOVE_LAST_BAN", interaction.user, u);

      return interaction.editReply("Last ban removed.");
    }

  } catch (e) {
    console.error(e);
    return interaction.editReply("An error occurred.");
  }
}

async function handleRecentBan(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
    return interaction.editReply("No permission.");

  const u = interaction.options.getUser("user");
  const rows = await getRows();
  const r = [...rows].reverse().find(x => x[0] === u.id);

  return interaction.editReply(
    r ? formatEventBan(r) : "No bans found."
  );
}

async function handleMyBan(interaction) {
  const rows = await getRows();
  const mine = rows.filter(r => r[0] === interaction.user.id && r[4] !== "0");

  if (!mine.length)
    return interaction.editReply("You have no active bans.");

  return interaction.editReply(
    mine.map(formatEventBan).join("\n\n")
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
