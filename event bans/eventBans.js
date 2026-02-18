const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");
const { google } = require("googleapis");

// ================= CONFIG =================
const SHEET_ID = "YOUR_SHEET_ID";
const EVENT_SHEET = "Event Bans";
const BAN_CHANNEL_ID = "YOUR_BAN_CHANNEL_ID";

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

// ================= COMMAND =================
const eventBanCommand = new SlashCommandBuilder()
  .setName("eventban")
  .setDescription("Event ban management")

  // APPLY
  .addSubcommand(sub =>
    sub.setName("apply")
      .setDescription("Apply an event ban")
      .addUserOption(o => o.setName("user").setRequired(true))
      .addStringOption(o =>
        o.setName("type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addIntegerOption(o =>
        o.setName("events").setRequired(true).setMinValue(1).setMaxValue(5)
      )
  )

  // PROBATION
  .addSubcommand(sub =>
    sub.setName("probation")
      .setDescription("Apply a probation ban")
      .addUserOption(o => o.setName("user").setRequired(true))
      .addIntegerOption(o =>
        o.setName("days").setRequired(true).setMinValue(1)
      )
      .addStringOption(o =>
        o.setName("start")
          .setDescription("YYYY-MM-DD (can be in the past)")
          .setRequired(true)
      )
  )

  // EVENT PASSED
  .addSubcommand(sub =>
    sub.setName("eventpassed")
      .setDescription("Reduce remaining bans of a type")
      .addStringOption(o =>
        o.setName("type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addIntegerOption(o =>
        o.setName("events").setRequired(true).setMinValue(1)
      )
  )

  // REMOVE LAST
  .addSubcommand(sub =>
    sub.setName("removelast")
      .setDescription("Remove last ban for a user")
      .addUserOption(o => o.setName("user").setRequired(true))
  );

// ================= HELPERS =================
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

function today() {
  return new Date().toISOString().split("T")[0];
}

// ================= HANDLER =================
async function handleEventBan(interaction) {
  const sub = interaction.options.getSubcommand();

  // ================= APPLY =================
  if (sub === "apply") {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply("No permission.");
    }

    const user = interaction.options.getUser("user");
    const type = interaction.options.getString("type");
    const events = interaction.options.getInteger("events");

    const rows = await getRows();
    rows.push([
      user.id,
      user.tag,
      type,
      events.toString(),
      events.toString(),
      today(),
      "",
      interaction.user.tag,
      ""
    ]);

    await writeRows(rows);

    await interaction.client.channels.fetch(BAN_CHANNEL_ID)
      .then(c =>
        c.send(
          `${user} received a **${events} event ${type} ban** — actioned by ${interaction.user.tag}`
        )
      );

    return interaction.editReply("Ban applied.");
  }

  // ================= PROBATION =================
  if (sub === "probation") {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply("No permission.");
    }

    const user = interaction.options.getUser("user");
    const days = interaction.options.getInteger("days");
    const start = interaction.options.getString("start");

    const end = new Date(start);
    end.setDate(end.getDate() + days);

    const rows = await getRows();
    rows.push([
      user.id,
      user.tag,
      "Probation",
      days.toString(),
      "",
      start,
      end.toISOString().split("T")[0],
      interaction.user.tag,
      ""
    ]);

    await writeRows(rows);

    await interaction.client.channels.fetch(BAN_CHANNEL_ID)
      .then(c =>
        c.send(
          `${user} placed on **${days}-day probation** (from ${start}) — actioned by ${interaction.user.tag}`
        )
      );

    return interaction.editReply("Probation applied.");
  }

  // ================= EVENT PASSED =================
  if (sub === "eventpassed") {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply("No permission.");
    }

    const type = interaction.options.getString("type");
    const passed = interaction.options.getInteger("events");

    const rows = await getRows();

    for (const row of rows) {
      if (row[2] === type && Number(row[4]) > 0) {
        row[4] = Math.max(0, Number(row[4]) - passed).toString();
      }
    }

    await writeRows(rows);

    await interaction.client.channels.fetch(BAN_CHANNEL_ID)
      .then(c =>
        c.send(
          `Remaining ${type} Events reduced by ${passed} — actioned by ${interaction.user.tag}`
        )
      );

    return interaction.editReply("Events applied.");
  }

  // ================= REMOVE LAST =================
  if (sub === "removelast") {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply("No permission.");
    }

    const user = interaction.options.getUser("user");
    const rows = await getRows();

    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i][0] === user.id) {
        rows.splice(i, 1);
        break;
      }
    }

    await writeRows(rows);

    await interaction.client.channels.fetch(BAN_CHANNEL_ID)
      .then(c =>
        c.send(
          `Last ban removed for ${user} — actioned by ${interaction.user.tag}`
        )
      );

    return interaction.editReply("Last ban removed.");
  }
}

// ================= EXTRA COMMANDS =================
const recentBanCommand = new SlashCommandBuilder()
  .setName("recentban")
  .setDescription("View a user's most recent event ban")
  .addUserOption(o => o.setName("user").setRequired(true));

const myBanCommand = new SlashCommandBuilder()
  .setName("myban")
  .setDescription("View your current event ban");

async function handleRecentBan(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply("No permission.");
  }

  const user = interaction.options.getUser("user");
  const rows = await getRows();
  const ban = [...rows].reverse().find(r => r[0] === user.id);

  return interaction.editReply(
    ban
      ? `Most recent ban for ${user}: **${ban[2]}**`
      : "No bans found."
  );
}

async function handleMyBan(interaction) {
  const rows = await getRows();
  const bans = rows.filter(r => r[0] === interaction.user.id && r[4] !== "0");

  if (!bans.length) {
    return interaction.editReply("You have no active event bans.");
  }

  return interaction.editReply(
    bans
      .map(b => `${b[2]} — ${b[4]} remaining`)
      .join("\n")
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
