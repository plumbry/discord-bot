const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { google } = require("googleapis");

const SHEET_ID = "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM";
const EVENT_SHEET = "Event Bans";
const BAN_CHANNEL_ID = "1472795189515915466";

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

const formatEventBan = r =>
`${r[1]} — ${r[3]}-Event ${r[2]} Ban Started ${r[5]}
${r[4]} Events Remaining
Reason: ${r[7] || "No reason provided"}`;

const formatProbation = r =>
`${r[1]} — Probation Started ${r[5]}
Ends: ${r[6]} (${r[3]} days)
Reason: ${r[7] || "No reason provided"}`;

const command = new SlashCommandBuilder()
  .setName("fixeventbanmessages")
  .setDescription("Repair event ban messages from the sheet")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

async function execute(interaction) {

  await interaction.deferReply();

  const channel = await interaction.guild.channels.fetch(BAN_CHANNEL_ID);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${EVENT_SHEET}!A2:J`
  });

  const rows = res.data.values || [];

  let edited = 0;
  let skipped = 0;

  for (const r of rows) {

    const messageId = r[9];

    if (!messageId) {
      skipped++;
      continue;
    }

    try {

      const msg = await channel.messages.fetch(messageId);

      const text =
        r[2] === "Probation"
          ? formatProbation(r)
          : formatEventBan(r);

      await msg.edit(text);

      edited++;

      await new Promise(r => setTimeout(r, 300));

    } catch {

      skipped++;

    }

  }

  await interaction.editReply(
`Repair complete.

Messages updated: ${edited}
Skipped (missing/deleted): ${skipped}`
  );

}

module.exports = {
  data: command,
  execute
};