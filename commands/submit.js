const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { getSheets } = require('../lib/sheets');

const SHEET_NAME = 'Player_Scores';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit')
    .setDescription('Submit match results')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction, { SUBMIT_SHEET_ID } = {}) {
    await interaction.deferReply({ ephemeral: true });

    const spreadsheetId =
      SUBMIT_SHEET_ID ||
      process.env.SUBMIT_SHEET_ID ||
      process.env.MAIN_SHEET_ID;

    if (!spreadsheetId) {
      return interaction.editReply({
        content: 'SUBMIT_SHEET_ID is not configured.'
      });
    }

    try {
      const sheets = getSheets();

      // =========================
      // LOAD EXISTING DATA
      // =========================

      // IMPORTANT:
      // Only load up to AX.
      // AY contains spreadsheet formulas for penalties
      // and should NEVER be touched by the bot.
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_NAME}!A3:AX`,
      });

      const rows = response.data.values || [];

      // =========================
      // CLEAN ROWS
      // =========================

      // A:AX = 50 columns total
      // DO NOT include AY
      const MIN_COLUMNS = 50;

      const cleanRows = rows.map((row) => {
        const cleaned = [...row];

        while (cleaned.length < MIN_COLUMNS) {
          cleaned.push('');
        }

        return cleaned.slice(0, MIN_COLUMNS);
      });

      // =========================
      // YOUR EXISTING SUBMIT LOGIC
      // =========================
      //
      // Put your normal player score updating logic here.
      // Example:
      //
      // cleanRows[playerIndex][columnIndex] = newValue;
      //
      // This will now ONLY affect columns A:AX
      // and leave AY formulas intact.

      // Example placeholder:
      //
      // const playerIndex = 0;
      // const columnIndex = 2;
      // cleanRows[playerIndex][columnIndex] = 50;

      // =========================
      // WRITE UPDATED DATA
      // =========================

      // IMPORTANT:
      // Only write A:AX.
      // AY formulas remain untouched in the sheet.
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SHEET_NAME}!A3:AX`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: cleanRows,
        },
      });

      await interaction.editReply({
        content: 'Results submitted successfully.',
      });

    } catch (error) {
      console.error(error);

      await interaction.editReply({
        content: 'Failed to submit results.',
      });
    }
  },
};