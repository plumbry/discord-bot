const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { google } = require('googleapis');

const GUILD_ID = '1371615693392576580';
const SHEET_NAME = 'Player_Scores';

function getSessionStartColumn(session) {
  return 2 + (session - 1) * 4;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit')
    .setDescription('Submit Yunite leaderboard')

    .addStringOption(opt =>
      opt
        .setName('tournamentid')
        .setDescription('Yunite tournament ID')
        .setRequired(true)
    )

    .addIntegerOption(opt =>
      opt
        .setName('session')
        .setDescription('Session number (1–12)')
        .setRequired(true)
    ),

  async execute(interaction) {
    console.log('COMMAND STARTED');

    await interaction.deferReply();

    try {
      const SPREADSHEET_ID = process.env.SUBMIT_SHEET_ID;
      const YUNITE_API_KEY = process.env.YUNITE_API_KEY;
      const GOOGLE_CREDS_BASE64 =
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

      if (!SPREADSHEET_ID || !YUNITE_API_KEY || !GOOGLE_CREDS_BASE64) {
        console.error("ENV DEBUG:", {
          SPREADSHEET_ID: !!SPREADSHEET_ID,
          YUNITE_API_KEY: !!YUNITE_API_KEY,
          GOOGLE_CREDS_BASE64: !!GOOGLE_CREDS_BASE64
        });

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

      console.log({ tournamentId, session });

      const url = `https://yunite.xyz/api/v3/guild/${GUILD_ID}/tournaments/${tournamentId}/leaderboard`;

      const response = await axios.get(url, {
        headers: { 'Y-API-Key': YUNITE_API_KEY },
      });

      // ✅ FIX: API RETURNS TEAMS, NOT PLAYERS
      const teams = Array.isArray(response.data) ? response.data : [];

      if (!teams.length) {
        return interaction.editReply('❌ No teams found');
      }

      const sheetRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:AZ`,
      });

      const rows = sheetRes.data.values || [];

      const playerMap = new Map();
      rows.forEach((row, i) => {
        if (row[0]) playerMap.set(row[0], i);
      });

      const startCol = getSessionStartColumn(session);

      let totalPlayers = 0;

      // ✅ CORE FIX: TEAM → USERS → GAME LIST
      for (const team of teams) {

        const games = (team.gameList || []).map(g => g.score || 0);

        // ensure 4 columns
        while (games.length < 4) games.push(0);

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

          row[0] = epicId;
          row[1] = username;

          // ✅ TEAM SCORES APPLIED TO EACH PLAYER
          row[startCol]     = games[0];
          row[startCol + 1] = games[1];
          row[startCol + 2] = games[2];
          row[startCol + 3] = games[3];
        }
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2`,
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