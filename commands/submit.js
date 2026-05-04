const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { google } = require('googleapis');

// ====== CONFIG ======
const GUILD_ID = '1371615693392576580';
const API_KEY = 'YOUR_REAL_API_KEY_HERE'; // replace dummy
const SPREADSHEET_ID = '1A4AAjxWBAKthiFm7ZoqjMy9kBHJtqBIs';

// Google auth (base64 string still required)
const creds = JSON.parse(
  Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString()
);

const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit')
    .setDescription('Import Yunite leaderboard')
    .addStringOption(opt =>
      opt.setName('tournament')
        .setDescription('Tournament ID')
        .setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('session')
        .setDescription('Scrim session number (1–12)')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const tournamentId = interaction.options.getString('tournament');
      const session = interaction.options.getInteger('session');

      if (session < 1 || session > 12) {
        return interaction.editReply('Session must be between 1 and 12.');
      }

      // ====== FETCH YUNITE DATA ======
      const res = await axios.get(
        `https://yunite.xyz/api/v3/guild/${GUILD_ID}/tournaments/${tournamentId}/leaderboard`,
        {
          headers: {
            'Y-API-Key': API_KEY
          }
        }
      );

      const data = res.data;

      if (!Array.isArray(data)) {
        return interaction.editReply('Unexpected API response format.');
      }

      // ====== SHEETS SETUP ======
      const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

      const sheetName = 'Player_Scores';

      // Read existing data
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A2:AZ`,
      });

      const rows = existing.data.values || [];

      // Build EpicID -> row index map
      const playerMap = {};
      rows.forEach((row, i) => {
        if (row[1]) playerMap[row[1]] = i + 2; // EpicID column = B
      });

      // Calculate session column start
      const startCol = 3 + (session - 1) * 4; // C = 3

      const updates = [];

      // ====== PROCESS TEAMS ======
      for (const team of data) {
        const penalties = team.corrections ? team.corrections.length : 0;

        for (const player of team.users) {
          const epicId = player.epicId;
          const name = player.name;

          let rowIndex = playerMap[epicId];

          // If new player → append
          if (!rowIndex) {
            const appendRes = await sheets.spreadsheets.values.append({
              spreadsheetId: SPREADSHEET_ID,
              range: `${sheetName}!A2`,
              valueInputOption: 'USER_ENTERED',
              resource: {
                values: [[name, epicId]]
              }
            });

            const updatedRange = appendRes.data.updates.updatedRange;
            rowIndex = parseInt(updatedRange.match(/\d+/)[0]);
            playerMap[epicId] = rowIndex;
          }

          // ====== WRITE 4 GAME SCORES ======
          team.gameList.slice(0, 4).forEach((game, i) => {
            updates.push({
              range: `${sheetName}!${columnLetter(startCol + i)}${rowIndex}`,
              values: [[game.score || 0]]
            });
          });

          // ====== WRITE PENALTY COUNT (COLUMN AY = 51) ======
          updates.push({
            range: `${sheetName}!AY${rowIndex}`,
            values: [[penalties]]
          });

          // ====== UPDATE NAME ======
          updates.push({
            range: `${sheetName}!A${rowIndex}`,
            values: [[name]]
          });
        }
      }

      // ====== APPLY BATCH UPDATE ======
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: updates
        }
      });

      await interaction.editReply(`Imported tournament ${tournamentId} (Session ${session})`);
    } catch (err) {
      console.error(err);
      await interaction.editReply('Error importing leaderboard.');
    }
  }
};

// ====== COLUMN HELPER ======
function columnLetter(col) {
  let letter = '';
  while (col > 0) {
    let temp = (col - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    col = Math.floor((col - temp - 1) / 26);
  }
  return letter;
}