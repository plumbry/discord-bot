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
      opt.setName('tournamentid').setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('session').setRequired(true)
    ),

  async execute(interaction) {
    console.log('COMMAND STARTED');

    await interaction.deferReply();

    try {
      // ===== ENV (SAFE LOAD) =====
      const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
      const YUNITE_API_KEY = process.env.YUNITE_API_KEY;
      const GOOGLE_CREDS_BASE64 = process.env.GOOGLE_CREDS_BASE64;

      if (!SPREADSHEET_ID || !YUNITE_API_KEY || !GOOGLE_CREDS_BASE64) {
        return interaction.editReply('❌ Missing environment variables');
      }

      // ===== GOOGLE AUTH (SAFE) =====
      const creds = JSON.parse(
        Buffer.from(GOOGLE_CREDS_BASE64, 'base64').toString()
      );

      const auth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });

      // ===== INPUT =====
      const tournamentId = interaction.options.getString('tournamentid');
      const session = interaction.options.getInteger('session');

      console.log({ tournamentId, session });

      // ===== FETCH YUNITE =====
      const url = `https://yunite.xyz/api/v3/guild/${GUILD_ID}/tournaments/${tournamentId}/leaderboard`;

      const response = await axios.get(url, {
        headers: { 'Y-API-Key': YUNITE_API_KEY },
      });

      const players =
        response.data?.players ||
        response.data?.data ||
        [];

      if (!players.length) {
        return interaction.editReply('❌ No players found');
      }

      // ===== READ SHEET =====
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

      // ===== PROCESS =====
      for (const p of players) {
        const epicId = p.epicId || p.id;
        const username = p.name || 'Unknown';

        const games = [
          p.matches?.[0]?.points || 0,
          p.matches?.[1]?.points || 0,
          p.matches?.[2]?.points || 0,
          p.matches?.[3]?.points || 0,
        ];

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

        row[startCol] = games[0];
        row[startCol + 1] = games[1];
        row[startCol + 2] = games[2];
        row[startCol + 3] = games[3];
      }

      // ===== WRITE =====
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: rows },
      });

      await interaction.editReply(
        `✅ Submitted ${players.length} players`
      );

    } catch (err) {
      console.error(err);

      try {
        await interaction.editReply(`❌ ${err.message}`);
      } catch {}
    }
  },
};