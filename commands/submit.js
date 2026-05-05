const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { google } = require('googleapis');

const GUILD_ID = '1371615693392576580';
const SHEET_NAME = 'Player_Scores';
const PENALTIES_SHEET = 'Penalties';

function getSessionStartColumn(session) {
  return 2 + (session - 1) * 4;
}

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

      const startCol = getSessionStartColumn(session);

      // ================= FETCH API =================
      const response = await axios.get(
        `https://yunite.xyz/api/v3/guild/${GUILD_ID}/tournaments/${tournamentId}/leaderboard`,
        { headers: { 'Y-Api-Token': YUNITE_API_KEY } }
      );

      const teams = Array.isArray(response.data)
        ? response.data
        : response.data?.data || [];

      if (!teams.length) {
        return interaction.editReply('❌ No teams found');
      }

      // ================= LOAD EXISTING DATA =================
      const sheetRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A3:AZ`,
      });

      const rows = sheetRes.data.values || [];

      const playerMap = new Map();

      rows.forEach((row, i) => {
        if (row[1]) playerMap.set(row[1], i); // EpicID = column B
      });

      // ================= LOAD EXISTING PENALTIES =================
      const penaltyRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${PENALTIES_SHEET}!I:I`,
      });

      const existingPenaltyIds = new Set(
        (penaltyRes.data.values || []).flat()
      );

      const newPenaltyRows = [];

      let totalPlayers = 0;

      // ================= PROCESS =================
      for (const team of teams) {

        const games = (team.gameList || [])
          .filter(g => g.counts)
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .map(g => g.score || 0);

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

          row[0] = username;
          row[1] = epicId;

          // ✅ ONLY WRITE CURRENT SESSION
          row[startCol]     = games[0];
          row[startCol + 1] = games[1];
          row[startCol + 2] = games[2];
          row[startCol + 3] = games[3];
        }

        // ================= PENALTIES =================
        for (const c of team.corrections || []) {

          if (!c.id || existingPenaltyIds.has(c.id)) continue;

          for (const user of team.users || []) {
            newPenaltyRows.push([
              c.timestamp || new Date().toISOString(),
              tournamentId,
              session,
              user.epicId,
              user.name || 'Unknown',
              team.teamId,
              c.amount || 0,
              c.reason || "",
              c.id
            ]);
          }
        }
      }

      // ================= NORMALISE ROW LENGTH =================
      const maxCols = startCol + 4;

      const cleanRows = rows.map(r => {
        const newRow = [];
        for (let i = 0; i < maxCols; i++) {
          newRow[i] = r?.[i] ?? "";
        }
        return newRow;
      });

      // ================= WRITE SCORES =================
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A3`,
        valueInputOption: 'RAW',
        requestBody: { values: cleanRows },
      });

      // ================= WRITE NEW PENALTIES =================
      if (newPenaltyRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${PENALTIES_SHEET}!A:I`,
          valueInputOption: 'RAW',
          requestBody: { values: newPenaltyRows },
        });
      }

      await interaction.editReply(
        `✅ Session ${session} submitted\n👥 ${totalPlayers} players\n⚠️ ${newPenaltyRows.length} new penalties logged`
      );

    } catch (err) {
      console.error(err);
      await interaction.editReply(`❌ ${err.message}`);
    }
  },
};