const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { google } = require('googleapis');

const GUILD_ID = '1371615693392576580';
const SHEET_NAME = 'Player_Scores';

// C = index 2
function getSessionStartColumn(session) {
  return 2 + (session - 1) * 4;
}

// AY column index (0-based)
const PENALTY_COL = 50;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit')
    .setDescription('Submit Yunite leaderboard')
    .addStringOption(opt =>
      opt.setName('tournamentid')
        .setDescription('Yunite tournament ID')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('session')
        .setDescription('Session number (1–12)')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const SPREADSHEET_ID = process.env.SUBMIT_SHEET_ID;
      const YUNITE_API_KEY = process.env.YUNITE_API_KEY;
      const GOOGLE_CREDS_BASE64 =
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

      if (!SPREADSHEET_ID || !YUNITE_API_KEY || !GOOGLE_CREDS_BASE64) {
        return interaction.editReply('❌ Missing environment variables');
      }

      const creds = JSON.parse(
        Buffer.from(GOOGLE_CREDS_BASE64, 'base64').toString('utf8')
      );

      const auth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });

      const tournamentId = interaction.options.getString('tournamentid');
      const session = interaction.options.getInteger('session');

      // ================= FETCH =================
      const response = await axios.get(
        `https://yunite.xyz/api/v3/guild/${GUILD_ID}/tournaments/${tournamentId}/leaderboard`,
        {
          headers: { 'Y-Api-Token': YUNITE_API_KEY },
        }
      );

      const teams = Array.isArray(response.data)
        ? response.data
        : response.data?.data || [];

      if (!teams.length) {
        return interaction.editReply('❌ No teams found');
      }

      // ================= READ SHEET (START AT ROW 3) =================
      const sheetRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A3:AZ`,
      });

      const rows = sheetRes.data.values || [];

      const playerMap = new Map();

      rows.forEach((row, i) => {
        const epicId = row[1]; // B column
        if (epicId) playerMap.set(epicId, i);
      });

      const startCol = getSessionStartColumn(session);

      let totalPlayers = 0;

      // ================= PROCESS =================
      for (const team of teams) {

        // games (only counted)
        const games = (team.gameList || [])
          .filter(g => g.counts)
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .map(g => g.score || 0);

        while (games.length < 4) games.push(0);

        // penalties
        const penaltyCount = (team.corrections || []).length;

        for (const user of team.users || []) {

          totalPlayers++;

          const epicId = user.epicId;
          const username = user.name || 'Unknown';

          let rowIndex;

          if (playerMap.has(epicId)) {
            rowIndex = playerMap.get(epicId);
          } else {
            rowIndex = rows.length;
            rows.push([]);
            playerMap.set(epicId, rowIndex);
          }

          const row = rows[rowIndex];

          // ✅ CORRECT COLUMN ORDER
          row[0] = username; // A
          row[1] = epicId;   // B

          // scores
          row[startCol]     = games[0];
          row[startCol + 1] = games[1];
          row[startCol + 2] = games[2];
          row[startCol + 3] = games[3];

          // penalties (AY)
          row[PENALTY_COL] = penaltyCount;
        }
      }

      // ================= FIX SPARSE ROWS =================
      const MAX_COLS = Math.max(startCol + 4, PENALTY_COL + 1);

      for (let i = 0; i < rows.length; i++) {
        if (!rows[i]) rows[i] = [];

        for (let j = 0; j < MAX_COLS; j++) {
          if (rows[i][j] === undefined) {
            rows[i][j] = "";
          }
        }
      }

      // ================= WRITE BACK TO ROW 3 =================
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A3`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      });

      await interaction.editReply(
        `✅ Submitted ${totalPlayers} players`
      );

    } catch (err) {
      console.error(err);

      try {
        await interaction.editReply(`❌ ${err.message}`);
      } catch {}
    }
  },
};