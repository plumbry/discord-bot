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
function today() {
  return new Date().toLocaleDateString("en-GB");
}

async function logAudit(action, moderator, user, details = "") {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${AUDIT_SHEET}!A2:D`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        today(),
        action,
        moderator.tag,
        user ? `${user.tag}${details ? " — " + details : ""}` : details
      ]]
    }
  });
}

async function getRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${EVENT_SHEET}!A2:I`
  });
  return res.data.values || [];
}

async function writeRows(rows) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${EVENT_SHEET}!A2:I`
  });

  if (rows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${EVENT_SHEET}!A2:I`,
      valueInputOption: "RAW",
      requestBody: { values: rows }
    });
  }
}

// ================= COMMAND BUILDERS =================
const eventBanCommand = new SlashCommandBuilder()
  .setName("eventban")
  .setDescription("Event ban management")

  .addSubcommand(sub =>
    sub
      .setName("apply")
      .setDescription("Apply an event ban")
      .addUserOption(o =>
        o.setName("user")
          .setDescription("User to ban")
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName("type")
          .setDescription("Ban type")
          .setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addIntegerOption(o =>
        o.setName("events")
          .setDescription("Number of events (1–5)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(5)
      )
      .addStringOption(o =>
        o.setName("reason")
          .setDescription("Reason for the ban")
          .setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("probation")
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
  )

  .addSubcommand(sub =>
    sub
      .setName("eventpassed")
      .setDescription("Reduce remaining bans")
      .addStringOption(o =>
        o.setName("type")
          .setDescription("Ban type")
          .setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addIntegerOption(o =>
        o.setName("events")
          .setDescription("Events passed")
          .setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub
      .setName("removelast")
      .setDescription("Remove last ban")
      .addUserOption(o =>
        o.setName("user").setDescription("User").setRequired(true)
      )
  );

const recentBanCommand = new SlashCommandBuilder()
  .setName("recentban")
  .setDescription("View a user's most recent event ban")
  .addUserOption(o =>
    o.setName("user").setDescription("User").setRequired(true)
  );

const myBanCommand = new SlashCommandBuilder()
  .setName("myban")
  .setDescription("View your current event ban");

// ================= HANDLERS =================
async function handleEventBan(interaction) {
  try {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply("You do not have permission to use this command.");
    }

    if (interaction.channelId !== BAN_CHANNEL_ID) {
      return interaction.editReply("This command can only be used in the ban channel.");
    }

    const sub = interaction.options.getSubcommand();
    const rows = await getRows();

    // APPLY
    if (sub === "apply") {
      const user = interaction.options.getUser("user");
      const type = interaction.options.getString("type");
      const events = interaction.options.getInteger("events");
      const reason = interaction.options.getString("reason");

      rows.push([
        user.id,
        user.tag,
        type,
        events.toString(),
        events.toString(),
        today(),
        "",
        interaction.user.tag,
        reason
      ]);

      await writeRows(rows);
      await logAudit(
        "EVENT_BAN_APPLY",
        interaction.user,
        user,
        `${events} ${type} — ${reason}`
      );

      await interaction.client.channels.fetch(BAN_CHANNEL_ID)
        .then(c =>
          c.send(
            `${user} received a **${events}-event ${type} ban**\n**Reason:** ${reason}\n— actioned by ${interaction.user.tag}`
          )
        );

      return interaction.editReply("Ban applied successfully.");
    }

    // PROBATION
    if (sub === "probation") {
      const user = interaction.options.getUser("user");
      const days = interaction.options.getInteger("days");
      const start = interaction.options.getString("start");

      rows.push([
        user.id,
        user.tag,
        "Probation",
        days.toString(),
        "",
        start,
        "",
        interaction.user.tag,
        ""
      ]);

      await writeRows(rows);
      await logAudit("PROBATION_APPLY", interaction.user, user);

      await interaction.client.channels.fetch(BAN_CHANNEL_ID)
        .then(c =>
          c.send(
            `${user} placed on **${days}-day probation** — actioned by ${interaction.user.tag}`
          )
        );

      return interaction.editReply("Probation applied.");
    }

    // EVENT PASSED
    if (sub === "eventpassed") {
      const type = interaction.options.getString("type");
      const passed = interaction.options.getInteger("events");

      for (const row of rows) {
        if (row[2] === type && Number(row[4]) > 0) {
          row[4] = Math.max(0, Number(row[4]) - passed).toString();
        }
      }

      await writeRows(rows);
      await logAudit(
        "EVENT_PASSED",
        interaction.user,
        null,
        `${type} reduced by ${passed}`
      );

      await interaction.client.channels.fetch(BAN_CHANNEL_ID)
        .then(c =>
          c.send(
            `Remaining ${type} Events reduced by ${passed} — actioned by ${interaction.user.tag}`
          )
        );

      return interaction.editReply("Event counts updated.");
    }

    // REMOVE LAST
    if (sub === "removelast") {
      const user = interaction.options.getUser("user");

      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i][0] === user.id) {
          rows.splice(i, 1);
          break;
        }
      }

      await writeRows(rows);
      await logAudit("REMOVE_LAST_BAN", interaction.user, user);

      await interaction.client.channels.fetch(BAN_CHANNEL_ID)
        .then(c =>
          c.send(
            `Last ban removed for ${user} — actioned by ${interaction.user.tag}`
          )
        );

      return interaction.editReply("Last ban removed.");
    }

    return interaction.editReply("Unknown subcommand.");

  } catch (err) {
    console.error("eventban error:", err);
    return interaction.editReply("An error occurred while processing this ban.");
  }
}

async function handleRecentBan(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply("You do not have permission to use this command.");
  }

  const user = interaction.options.getUser("user");
  const rows = await getRows();
  const ban = [...rows].reverse().find(r => r[0] === user.id);

  return interaction.editReply(
    ban
      ? `Most recent ban for ${user}: **${ban[2]}** — ${ban[8] || "No reason"}`
      : "No bans found."
  );
}

async function handleMyBan(interaction) {
  const rows = await getRows();
  const bans = rows.filter(r =>
    r[0] === interaction.user.id && r[4] !== "0"
  );

  if (!bans.length) {
    return interaction.editReply("You have no active event bans.");
  }

  return interaction.editReply(
    bans.map(b =>
      `${b[2]} — ${b[4]} remaining\nReason: ${b[8] || "N/A"}`
    ).join("\n\n")
  );
}

// ================= EXPORTS =================
module.exports = {
  eventBanCommand,
  handleEventBan,
  recentBanCommand,
  handleRecentBan,
  myBanCommand,
  handleMyBan
};
