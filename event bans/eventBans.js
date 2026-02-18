const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");
const { google } = require("googleapis");

// ================= CONFIG =================
const SHEET_ID = "YOUR_SHEET_ID";
const EVENT_SHEET = "Event Bans";
const AUDIT_SHEET = "Audit Log";
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

// ================= HELPERS =================
function today() {
  return new Date().toLocaleDateString("en-GB");
}

async function logAudit(action, moderator, user) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${AUDIT_SHEET}!A2:D`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        today(),
        action,
        moderator.tag,
        user?.tag || ""
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

// ================= COMMANDS =================
const eventBanCommand = new SlashCommandBuilder()
  .setName("eventban")
  .setDescription("Event ban management")

  .addSubcommand(sub =>
    sub.setName("apply")
      .setDescription("Apply an event ban")
      .addUserOption(o =>
        o.setName("user").setDescription("User to ban").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("type").setDescription("Ban type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addIntegerOption(o =>
        o.setName("events").setDescription("Number of events").setRequired(true)
          .setMinValue(1).setMaxValue(5)
      )
  )

  .addSubcommand(sub =>
    sub.setName("probation")
      .setDescription("Apply a probation ban")
      .addUserOption(o =>
        o.setName("user").setDescription("User to probation").setRequired(true)
      )
      .addIntegerOption(o =>
        o.setName("days").setDescription("Number of days").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("start").setDescription("Start date YYYY-MM-DD").setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub.setName("eventpassed")
      .setDescription("Reduce remaining bans")
      .addStringOption(o =>
        o.setName("type").setDescription("Ban type").setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addIntegerOption(o =>
        o.setName("events").setDescription("Events passed").setRequired(true)
      )
  )

  .addSubcommand(sub =>
    sub.setName("removelast")
      .setDescription("Remove last ban")
      .addUserOption(o =>
        o.setName("user").setDescription("User").setRequired(true)
      )
  );

// ================= HANDLER =================
async function handleEventBan(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply("No permission.");
  }

  if (interaction.channelId !== BAN_CHANNEL_ID) {
    return interaction.editReply("Wrong channel.");
  }

  const sub = interaction.options.getSubcommand();
  const rows = await getRows();

  if (sub === "apply") {
    const user = interaction.options.getUser("user");
    const type = interaction.options.getString("type");
    const events = interaction.options.getInteger("events");

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
    await logAudit("EVENT_BAN_APPLY", interaction.user, user);

    await interaction.client.channels.fetch(BAN_CHANNEL_ID)
      .then(c => c.send(
        `${user} received a **${events}-event ${type} ban** — actioned by ${interaction.user.tag}`
      ));

    return interaction.editReply("Ban applied.");
  }

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
      .then(c => c.send(
        `${user} placed on **${days}-day probation** — actioned by ${interaction.user.tag}`
      ));

    return interaction.editReply("Probation applied.");
  }

  if (sub === "eventpassed") {
    const type = interaction.options.getString("type");
    const passed = interaction.options.getInteger("events");

    for (const row of rows) {
      if (row[2] === type && Number(row[4]) > 0) {
        row[4] = Math.max(0, Number(row[4]) - passed).toString();
      }
    }

    await writeRows(rows);
    await logAudit("EVENT_PASSED", interaction.user, null);

    await interaction.client.channels.fetch(BAN_CHANNEL_ID)
      .then(c => c.send(
        `Remaining ${type} Events reduced by ${passed} — actioned by ${interaction.user.tag}`
      ));

    return interaction.editReply("Events applied.");
  }

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
      .then(c => c.send(
        `Last ban removed for ${user} — actioned by ${interaction.user.tag}`
      ));

    return interaction.editReply("Last ban removed.");
  }
}

// ================= EXPORTS =================
module.exports = {
  eventBanCommand,
  handleEventBan
};
