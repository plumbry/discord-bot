const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");
const { google } = require("googleapis");

// ================= CONFIG =================
const SHEET_ID = "PASTE_REAL_SHEET_ID";
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
function today() {
  return new Date().toLocaleDateString("en-GB");
}

async function logAudit(action, moderator, user) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${AUDIT_SHEET}!A2:D`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[today(), action, moderator.tag, user?.tag || ""]]
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

function formatBanMessage(row) {
  const [
    userId,
    username,
    type,
    original,
    remaining,
    start,
    ,
    ,
    reason
  ] = row;

  return `${username} — ${original}-Event ${type} Ban Started ${start}
${remaining} Events Remaining
Reason: ${reason}`;
}

// ================= COMMANDS =================
const eventBanCommand = new SlashCommandBuilder()
  .setName("eventban")
  .setDescription("Event ban management")

  .addSubcommand(sub =>
    sub.setName("apply")
      .setDescription("Apply an event ban")
      .addUserOption(o =>
        o.setName("user").setDescription("User").setRequired(true)
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
      .addStringOption(o =>
        o.setName("reason").setDescription("Reason").setRequired(true)
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
  );

// ================= HANDLER =================
async function handleEventBan(interaction) {
  try {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.editReply("No permission.");
    }

    if (interaction.channelId !== BAN_CHANNEL_ID) {
      return interaction.editReply("Wrong channel.");
    }

    const sub = interaction.options.getSubcommand();
    const rows = await getRows();
    const channel = await interaction.client.channels.fetch(BAN_CHANNEL_ID);

    // ===== APPLY =====
    if (sub === "apply") {
      const user = interaction.options.getUser("user");
      const type = interaction.options.getString("type");
      const events = interaction.options.getInteger("events");
      const reason = interaction.options.getString("reason");

      const row = [
        user.id,
        user.username,
        type,
        events.toString(),
        events.toString(),
        today(),
        "",
        interaction.user.tag,
        reason,
        "" // message ID
      ];

      const message = await channel.send(formatBanMessage(row));
      row[9] = message.id;

      rows.push(row);
      await writeRows(rows);
      await logAudit("EVENT_BAN_APPLY", interaction.user, user);

      return interaction.editReply("Ban applied.");
    }

    // ===== EVENT PASSED =====
    if (sub === "eventpassed") {
      const type = interaction.options.getString("type");
      const passed = interaction.options.getInteger("events");

      for (const row of rows) {
        if (row[2] === type && Number(row[4]) > 0) {
          row[4] = Math.max(0, Number(row[4]) - passed).toString();

          if (row[9]) {
            const msg = await channel.messages.fetch(row[9]);
            await msg.edit(formatBanMessage(row));
          }
        }
      }

      await writeRows(rows);
      await logAudit("EVENT_PASSED", interaction.user, null);

      await channel.send(
        `Remaining ${type} Events reduced by ${passed} — actioned by ${interaction.user.tag}`
      );

      return interaction.editReply("Event bans updated.");
    }

  } catch (err) {
    console.error(err);
    return interaction.editReply("An error occurred.");
  }
}

// ================= EXPORTS =================
module.exports = {
  eventBanCommand,
  handleEventBan
};
