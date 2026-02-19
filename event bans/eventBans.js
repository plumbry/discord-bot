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

const addDays = (start, days) => {
  const d = new Date(start);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-GB");
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
        o.setName("events").setDescription("Events").setRequired(true)
          .setMinValue(1).setMaxValue(5))
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
      .addIntegerOption(o =>
        o.setName("events").setDescription("Events passed").setRequired(true))
  )

  .addSubcommand(s =>
    s.setName("removelast")
      .setDescription("Remove last ban")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
  )

  .addSubcommand(s =>
    s.setName("summary")
      .setDescription("View summary of active event bans")
  )

  .addSubcommand(s =>
    s.setName("history")
      .setDescription("View full event ban history for a user")
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
    await interaction.deferReply({ ephemeral: false });

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return interaction.editReply("No permission.");

    if (interaction.channelId !== BAN_CHANNEL_ID)
      return interaction.editReply("Wrong channel.");

    const sub = interaction.options.getSubcommand();
    const rows = await getRows();
    const channel = await interaction.client.channels.fetch(BAN_CHANNEL_ID);

    // ===== SUMMARY (UPDATED) =====
    if (sub === "summary") {
      const activeEvents = rows.filter(
        r => r[2] !== "Probation" && Number(r[4]) > 0
      );

      const probations = rows.filter(
        r => r[2] === "Probation" && r[9] !== "ENDED"
      );

      const uniquePlayers = [
        ...new Set(activeEvents.map(r => r[1]))
      ];

      const playerList = uniquePlayers.length
        ? uniquePlayers.join(", ")
        : "None";

      return interaction.editReply(
        `📊 **Event Ban Summary**\n\n` +
        `Active Event Bans: **${activeEvents.length}**\n` +
        `Active Probations: **${probations.length}**\n\n` +
        `👥 **Banned Players:**\n${playerList}`
      );
    }

    // ===== HISTORY =====
    if (sub === "history") {
      const u = interaction.options.getUser("user");
      const history = rows.filter(r => r[0] === u.id);

      if (!history.length)
        return interaction.editReply({ content: "No history found.", ephemeral: true });

      const out = history
        .reverse()
        .map(r =>
          r[2] === "Probation"
            ? formatProbation(r)
            : formatEventBan(r)
        )
        .join("\n\n");

      return interaction.editReply({ content: out, ephemeral: true });
    }

    // ===== EXISTING LOGIC BELOW (UNCHANGED) =====

    if (sub === "apply") {
      const u = interaction.options.getUser("user");
      const type = interaction.options.getString("type");
      const events = interaction.options.getInteger("events");
      const reason = interaction.options.getString("reason");

      const row = [
        u.id, u.username, type,
        events.toString(), events.toString(),
        today(), today(),
        reason,
        interaction.user.tag,
        ""
      ];

      const msg = await channel.send(formatEventBan(row));
      row[9] = msg.id;

      rows.push(row);
      await writeRows(rows);
      await logAudit("EVENT_BAN_APPLY", interaction.user, u);

      return interaction.editReply("Event ban applied.");
    }

    if (sub === "probation") {
      const u = interaction.options.getUser("user");
      const days = interaction.options.getInteger("days");
      const start = interaction.options.getString("start");
      const reason = interaction.options.getString("reason");

      const end = addDays(start, days);

      const row = [
        u.id, u.username, "Probation",
        days.toString(), "",
        start, end,
        reason,
        interaction.user.tag,
        "PROBATION"
      ];

      await channel.send(formatProbation(row));

      rows.push(row);
      await writeRows(rows);
      await logAudit("PROBATION_APPLY", interaction.user, u);

      return interaction.editReply("Probation applied.");
    }

    if (sub === "eventpassed") {
      const type = interaction.options.getString("type");
      const passed = interaction.options.getInteger("events");

      for (const r of rows) {
        if (r[2] === type && Number(r[4]) > 0) {
          r[4] = Math.max(0, Number(r[4]) - passed).toString();
          r[6] = today();

          if (r[9] && r[9] !== "PROBATION" && r[9] !== "ENDED") {
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

    if (sub === "removelast") {
      const u = interaction.options.getUser("user");

      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i][0] === u.id) {
          rows.splice(i, 1);
          break;
        }
      }

      await writeRows(rows);
      await logAudit("REMOVE_LAST_BAN", interaction.user, u);

      return interaction.editReply(`Last ban for ${u.username} removed`);
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

  if (!r) return interaction.editReply("No bans found.");

  return interaction.editReply(formatEventBan(r));
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