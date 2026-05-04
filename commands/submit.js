const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { google } = require('googleapis');

// ===== ENV CONFIG =====
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const YUNITE_API_KEY = process.env.YUNITE_API_KEY;
const GOOGLE_CREDS_BASE64 = process.env.GOOGLE_CREDS_BASE64;

const GUILD_ID = '1371615693392576580';
const SHEET_NAME = 'Player_Scores';

// ===== VALIDATION =====
if (!SPREADSHEET_ID) throw new Error('Missing SPREADSHEET_ID');
if (!YUNITE_API_KEY) throw new Error('Missing YUNITE_API_KEY');
if (!GOOGLE_CREDS_BASE64) throw new Error('Missing GOOGLE_CREDS_BASE64');

// ===== GOOGLE AUTH =====
let sheets;

try {
  console.log('INIT: Decoding Google credentials');

  const creds = JSON.parse(
    Buffer.from(GOOGLE_CREDS_BASE64, 'base64').toString()
  );

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  sheets = google.sheets({ version: 'v4', auth });

  console.log('INIT: Google auth success');
} catch (err) {
  console.error('INIT ERROR (Google Auth):', err);
}

// ===== HELPER =====
function getSessionStartColumn(session) {
  return 2 + (session - 1) * 4;
}

// ===== COMMAND =====
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
        .setDescription('Scrim session number (1–12)')
        .setRequired(true)
    ),

  async execute(interaction) {
    console.log('COMMAND STARTED');

    await interaction.deferReply();
    console.log('DEFERRED OK');

    try {
      const tournamentId = interaction.options.getString('tournamentid');
      const session = interaction.options.getInteger('session');

      console.log('INPUT:', { tournamentId, session });

      // ===== FETCH YUNITE =====
      console.log('STEP 1: Fetching Yunite');

      const url = `https://yunite.xyz/api/v3/guild/${GUILD_ID}/tournaments/${tournamentId}/leaderboard`;

      const response = await axios.get(url, {
        headers: {
          'Y-API-Key': YUNITE_API_KEY,
        },
      });

      console.log('STEP 2: Yunite response received');

      const players =
        response.data?.players ||
        response.data?.data ||
        response.data ||
        [];

      console.log('Players found:', players.length);

      if (!players.length) {
        return interaction.editReply('❌ No players returned from Yunite');
      }

      // ===== READ SHEET =====
      console.log('STEP 3: Reading sheet');

      const sheetRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:AZ`,
      });

      console.log('STEP 4: Sheet read success');

      const rows = sheetRes.data.values || [];

      const playerMap = new Map();
      rows.forEach((row, i) => {
        if (row[0]) playerMap.set(row[0], i);
      });

      const startCol = getSessionStartColumn(session);

      // ===== PROCESS PLAYERS =====
      console.log('STEP 5: Processing players');

      for (const p of players) {
        const epicId = p.epicId || p.id;
        const username = p.name || p.username || 'Unknown';

        if (!epicId) {
          console.log('Skipping player with no epicId');
          continue;
        }

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

      // ===== WRITE TO SHEET =====
      console.log('STEP 6: Writing to sheet');

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: rows,
        },
      });

      console.log('STEP 7: Write complete');

      await interaction.editReply(
        `✅ Submitted ${players.length} players for S${session}`
      );

    } catch (err) {
      console.error('FULL ERROR:', err);

      try {
        await interaction.editReply(
          `❌ Error: ${err.response?.data?.error?.message || err.message}`
        );
      } catch (e) {
        console.error('FAILED TO REPLY:', e);
      }
    }
  },
};