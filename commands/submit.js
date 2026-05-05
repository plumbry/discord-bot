const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { google } = require('googleapis');

const GUILD_ID = '1371615693392576580';
const SHEET_NAME = 'Player_Scores';
const PENALTIES_SHEET = 'Penalties';

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
    console.log("=== SUBMIT COMMAND STARTED ===");

    await interaction.deferReply();

    try {
      const SPREADSHEET_ID = process.env.SUBMIT_SHEET_ID;
      const YUNITE_API_KEY = process.env.YUNITE_API_KEY;
      const GOOGLE_CREDS_BASE64 =
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

      if (!SPREADSHEET_ID || !YUNITE_API_KEY || !GOOGLE_CREDS_BASE64) {
        console.error("❌ ENV MISSING");
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

      console.log("Teams fetched:", teams.length);

      if (!teams.length) {
        return interaction.editReply('❌ No teams found');
      }

      // ================= BUILD PLAYER DATA =================
      const rows = [];
      const playerMap = new Map();
      const penaltyRows = [];

      const startCol = getSessionStartColumn(session);

      let totalPlayers = 0;

      for (const team of teams) {

        const games = (team.gameList || [])
          .filter(g => g.counts)
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .map(g => g.score || 0);

        while (games.length < 4) games.push(0);

        const corrections = team.corrections || [];

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

          // Player sheet
          row[0] = username;
          row[1] = epicId;

          row[startCol]     = games[0];
          row[startCol + 1] = games[1];
          row[startCol + 2] = games[2];
          row[startCol + 3] = games[3];


          // ================= PENALTY LOGGING =================
          for (const c of corrections) {
            penaltyRows.push([
              c.timestamp || new Date().toISOString(),
              tournamentId,
              session,
              epicId,
              username,
              team.teamId,
              c.amount || 0,
              c.reason || "",
              c.id || ""
            ]);
          }
        }
      }

      // ================= CLEAN MATRIX =================
      const MAX_COLS = Math.max(startCol + 4, PENALTY_COL + 1);

      const cleanRows = rows.map(r => {
        const newRow = [];
        for (let i = 0; i < MAX_COLS; i++) {
          newRow[i] = r?.[i] ?? "";
        }
        return newRow;
      });

      // ================= WRITE PLAYER SCORES =================
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A3`,
        valueInputOption: 'RAW',
        requestBody: { values: cleanRows },
      });

      // ================= WRITE PENALTIES =================
      if (penaltyRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${PENALTIES_SHEET}!A:I`,
          valueInputOption: 'RAW',
          requestBody: { values: penaltyRows },
        });

        console.log("Penalties logged:", penaltyRows.length);
      }

      await interaction.editReply(
        `✅ Submitted ${totalPlayers} players\n⚠️ Logged ${penaltyRows.length} penalties`
      );

    } catch (err) {
      console.error("❌ SUBMIT ERROR:", err);

      try {
        await interaction.editReply(`❌ ${err.message}`);
      } catch {}
    }
  },
};