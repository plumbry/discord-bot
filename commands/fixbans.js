const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { getSheets } = require("../lib/sheets");
const { EVENT_BAN_RANGE } = require("../lib/eventBanSheet");

// ================= CONFIG =================

const SHEET_ID = process.env.MAIN_SHEET_ID;
const BAN_CHANNEL_ID = "1472795189515915466";

// ================= MESSAGE FORMATTERS =================

const { isOffenseRow, isProbationRow } = require("../lib/eventBanRoles");

function formatEventBan(r) {
  if (isOffenseRow(r)) {
    return (
      `${r[1]} — ${r[2]}\n` +
      `Logged ${r[5]}\n` +
      "_No event ban — offense log._\n" +
      `Reason: ${r[7] || "No reason provided"}`
    );
  }

  return (
    `${r[1]} — ${r[2]}\n` +
    `Started ${r[5]}\n` +
    `${r[4]} event(s) remaining\n` +
    `Reason: ${r[7] || "No reason provided"}`
  );
}

const formatProbation = r =>
`${r[1]} — Probation Started ${r[5]}
Ends: ${r[6]} (${r[3]} days)
Reason: ${r[7] || "No reason provided"}`;

// ================= COMMAND =================

const data = new SlashCommandBuilder()
  .setName("fixbans")
  .setDescription("Repair event ban messages from the sheet")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);

// ================= EXECUTE =================

async function execute(interaction) {

  await interaction.deferReply({ ephemeral: true });

  // ================= GOOGLE AUTH =================

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    return interaction.editReply("❌ Google credentials are not configured.");
  }

  if (!process.env.MAIN_SHEET_ID) {
    return interaction.editReply("❌ MAIN_SHEET_ID is not configured.");
  }

  const sheets = getSheets();

  // ================= CHANNEL =================

  let channel;

  try {
    channel = await interaction.guild.channels.fetch(BAN_CHANNEL_ID);
  } catch {
    return interaction.editReply("❌ Could not access the ban channel.");
  }

  // ================= LOAD SHEET =================

  let rows;

  try {

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: EVENT_BAN_RANGE
    });

    rows = res.data.values || [];

  } catch (err) {

    console.error("Sheet fetch failed:", err);
    return interaction.editReply("❌ Failed to read the Google Sheet.");

  }

  let edited = 0;
  let skipped = 0;

  // ================= PROCESS ROWS =================

  for (const r of rows) {

    const messageId = r[9];

    if (!messageId) {
      skipped++;
      continue;
    }

    try {

      const msg = await channel.messages.fetch(messageId);

      const text = isProbationRow(r)
        ? formatProbation(r)
        : formatEventBan(r);

      await msg.edit(text);

      edited++;

      await new Promise(resolve => setTimeout(resolve, 300));

    } catch {

      skipped++;

    }

  }

  // ================= RESULT =================

  await interaction.editReply(
`✅ Ban repair complete

Messages updated: ${edited}
Skipped (missing/deleted): ${skipped}`
  );

}

// ================= EXPORT =================

module.exports = {
  data,
  execute
};
