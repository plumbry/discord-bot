const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { google } = require('googleapis');

const GUILD_ID = '1371615693392576580';
const SHEET_NAME = 'Player_Scores';
const PENALTIES_SHEET = 'Penalties';

// Session columns:
// Session 1 = C:F
// Session 2 = G:J
// etc
function getSessionStartColumn(session) {
  return 2 + (session - 1) * 4;
}

const MIN_COLUMNS = 52; // A:AZ
const MIN_ROWS = 200;

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
        .setDescription('Session number (1-12)')
        .setRequired(true)
    ),

  async execute(interaction) {

    console.log("=== SUBMIT START ===");

    await interaction.deferReply();

    try {

      // ================= ENV =================

      const SPREADSHEET_ID = process.env.SUBMIT_SHEET_ID;
      const YUNITE_API_KEY = process.env.YUNITE_API_KEY;
      const GOOGLE_CREDS_BASE64 =
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

      if (
        !SPREADSHEET_ID ||
        !YUNITE_API_KEY ||
        !GOOGLE_CREDS_BASE64
      ) {
        console.error("❌ Missing env vars");

        return interaction.editReply(
          '❌ Missing environment variables'
        );
      }

      // ================= GOOGLE AUTH =================

      const creds = JSON.parse(
        Buffer.from(
          GOOGLE_CREDS_BASE64,
          'base64'
        ).toString('utf8')
      );

      const auth = new google.auth.GoogleAuth({
        credentials: creds,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
        ],
      });

      const sheets = google.sheets({
        version: 'v4',
        auth,
      });

      // ================= INPUT =================

      const tournamentId =
        interaction.options.getString('tournamentid');

      const session =
        interaction.options.getInteger('session');

      const startCol =
        getSessionStartColumn(session);

      console.log({
        tournamentId,
        session,
        startCol
      });

      // ================= FETCH API =================

      const response = await axios.get(
        `https://yunite.xyz/api/v3/guild/${GUILD_ID}/tournaments/${tournamentId}/leaderboard`,
        {
          headers: {
            'Y-Api-Token': YUNITE_API_KEY,
          },
        }
      );

      const teams = Array.isArray(response.data)
        ? response.data
        : response.data?.data || [];

      console.log("Teams fetched:", teams.length);

      if (!teams.length) {
        return interaction.editReply(
          '❌ No teams found'
        );
      }

      // ================= LOAD PLAYER SHEET =================

      const sheetRes =
        await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!A3:AZ`,
        });

      let rows = sheetRes.data.values || [];

      console.log(
        "Rows loaded from sheet:",
        rows.length
      );

      // keep stable row count
      while (rows.length < MIN_ROWS) {
        rows.push([]);
      }

      // ================= BUILD PLAYER MAP =================

      // key = epicId
      // value = row index in rows[]

      const playerMap = new Map();

      rows.forEach((row, i) => {

        const epicId = row[1]; // column B

        if (
          epicId &&
          !playerMap.has(epicId)
        ) {
          playerMap.set(epicId, i);
        }

      });

      console.log(
        "Mapped players:",
        playerMap.size
      );

      // ================= LOAD EXISTING PENALTIES =================

      const penaltyRes =
        await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${PENALTIES_SHEET}!I:I`,
        });

      const existingPenaltyIds = new Set(
        (penaltyRes.data.values || []).flat()
      );

      console.log(
        "Existing penalties:",
        existingPenaltyIds.size
      );

      const newPenaltyRows = [];

      // prevents duplicates in same run
      const seenThisRun = new Set();

      let totalPlayers = 0;

      // ================= PROCESS TEAMS =================

      for (const team of teams) {

        // ================= GAMES =================
        // IMPORTANT:
        // We IGNORE counts=true/false
        // because sheet logic handles best 3/4

        const games = (team.gameList || [])
          .sort((a, b) =>
            a.timestamp.localeCompare(
              b.timestamp
            )
          )
          .slice(0, 4)
          .map(g => g.score ?? "");

        // ensure 4 columns always exist
        while (games.length < 4) {
          games.push("");
        }

        console.log(
          "Team games:",
          team.teamId,
          games
        );

        // ================= USERS =================

        for (const user of team.users || []) {

          const epicId = user.epicId;

          // skip invalid
          if (!epicId) continue;

          // skip duplicates in same API run
          if (seenThisRun.has(epicId)) {
            console.log(
              "Duplicate skipped:",
              epicId
            );
            continue;
          }

          seenThisRun.add(epicId);

          totalPlayers++;

          const username =
            user.name || 'Unknown';

          let rowIndex =
            playerMap.get(epicId);

          // ================= NEW PLAYER =================

          if (rowIndex === undefined) {

            // find first empty row
            rowIndex = rows.findIndex(
              r => !r[1]
            );

            if (rowIndex === -1) {
              rowIndex = rows.length;
              rows.push([]);
            }

            playerMap.set(
              epicId,
              rowIndex
            );

            console.log(
              `New player row assigned: ${username} -> ${rowIndex + 3}`
            );
          }

          const row = rows[rowIndex];

          // ================= IDENTITY =================

          row[0] = username; // A
          row[1] = epicId;   // B

          // ================= SESSION SCORES =================
          // ONLY writes current session block

          row[startCol]     = games[0];
          row[startCol + 1] = games[1];
          row[startCol + 2] = games[2];
          row[startCol + 3] = games[3];

        }

        // ================= PENALTIES =================

        for (const c of team.corrections || []) {

          // skip duplicates
          if (
            !c.id ||
            existingPenaltyIds.has(c.id)
          ) continue;

          for (const user of team.users || []) {

            newPenaltyRows.push([
              c.timestamp ||
                new Date().toISOString(),

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

      // ================= NORMALISE =================

      const maxCols = Math.max(
        MIN_COLUMNS,
        startCol + 4
      );

      const cleanRows = rows.map(r => {

        const newRow = [];

        for (let i = 0; i < maxCols; i++) {
          newRow[i] = r?.[i] ?? "";
        }

        return newRow;
      });

      console.log(
        "Final clean rows:",
        cleanRows.length
      );

      // ================= WRITE PLAYER DATA =================

      const writeRes =
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!A3:AZ`,
          valueInputOption: 'RAW',
          requestBody: {
            values: cleanRows,
          },
        });

      console.log(
        "Player scores updated:",
        writeRes.data.updatedCells
      );

      // ================= WRITE PENALTIES =================

      if (newPenaltyRows.length > 0) {

        const penaltyWrite =
          await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${PENALTIES_SHEET}!A:I`,
            valueInputOption: 'RAW',
            requestBody: {
              values: newPenaltyRows,
            },
          });

        console.log(
          "Penalties written:",
          penaltyWrite.data.updates?.updatedRows || 0
        );
      }

      // ================= COMPLETE =================

      await interaction.editReply(
        `✅ Session ${session} submitted\n` +
        `👥 ${totalPlayers} players processed\n` +
        `⚠️ ${newPenaltyRows.length} new penalties logged`
      );

    } catch (err) {

      console.error(
        "❌ SUBMIT ERROR:",
        err
      );

      try {
        await interaction.editReply(
          `❌ ${err.message}`
        );
      } catch {}

    }
  },
};