const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const { getSheets } = require('../lib/sheets');

const GUILD_ID = '1371615693392576580';
const SHEET_NAME = 'Player_Scores';
const PENALTIES_SHEET = 'Penalties';

// Session 1 = C:F, session 2 = G:J, ...
function getSessionStartColumn(session) {
  return 2 + (session - 1) * 4;
}

// A:AX = 50 columns; AY+ holds penalty formulas and must not be touched
const MIN_COLUMNS = 50;

function padRow(row) {
  const cleaned = [...(row || [])];
  while (cleaned.length < MIN_COLUMNS) {
    cleaned.push('');
  }
  return cleaned.slice(0, MIN_COLUMNS);
}

/** Dedup key: tournament + session + Yunite correction id + player. */
function penaltyDedupKey(tournamentId, session, correctionId, epicId) {
  return `${tournamentId}|${session}|${correctionId}|${epicId}`;
}

function correctionStableId(c, team, tournamentId, session, index) {
  if (c.id) return String(c.id);
  const ts = c.timestamp || '';
  const reason = String(c.reason || '').slice(0, 40);
  return `gen-${tournamentId}-s${session}-${team.teamId || 'team'}-${index}-${ts}-${reason}`;
}

/** If Yunite tags a specific player on the correction, only apply to them. */
function correctionTargetsUser(c, user) {
  const target =
    c.epicId ??
    c.userEpicId ??
    c.userId ??
    c.playerEpicId ??
    c.playerId;
  if (target == null || target === '') return true;
  return (
    String(target) === String(user.epicId) ||
    String(target) === String(user.id)
  );
}

function normalizePenaltyAmount(amount) {
  if (amount == null || amount === '') return 0;
  const n = Number(amount);
  return Number.isNaN(n) ? 0 : n;
}

async function loadExistingPenaltyKeys(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${PENALTIES_SHEET}!A:I`,
  });

  const keys = new Set();
  for (const row of res.data.values || []) {
    const tournamentId = row[1];
    const session = row[2];
    const epicId = row[3];
    const correctionId = row[8];
    if (!correctionId || !epicId) continue;
    keys.add(
      penaltyDedupKey(
        String(tournamentId),
        String(session),
        String(correctionId),
        String(epicId)
      )
    );
  }
  return keys;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit')
    .setDescription('Submit match results from Yunite')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName('id')
        .setDescription('Yunite tournament ID')
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('session')
        .setDescription('Session number (1-12)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(12)
    ),

  async execute(interaction, { SUBMIT_SHEET_ID } = {}) {
    await interaction.deferReply({ ephemeral: true });

    const spreadsheetId =
      SUBMIT_SHEET_ID ||
      process.env.SUBMIT_SHEET_ID ||
      process.env.MAIN_SHEET_ID;
    const yuniteApiKey = process.env.YUNITE_API_KEY;

    if (!spreadsheetId) {
      return interaction.editReply({
        content: 'SUBMIT_SHEET_ID is not configured.',
      });
    }

    if (!yuniteApiKey) {
      return interaction.editReply({
        content: 'YUNITE_API_KEY is not configured.',
      });
    }

    const tournamentId = interaction.options.getString('id');
    const session = interaction.options.getInteger('session');
    const startCol = getSessionStartColumn(session);

    try {
      const sheets = getSheets();

      // =========================
      // FETCH YUNITE LEADERBOARD
      // =========================

      const apiRes = await axios.get(
        `https://yunite.xyz/api/v3/guild/${GUILD_ID}/tournaments/${tournamentId}/leaderboard`,
        {
          headers: { 'Y-Api-Token': yuniteApiKey },
        }
      );

      const teams = Array.isArray(apiRes.data)
        ? apiRes.data
        : apiRes.data?.data || [];

      if (!teams.length) {
        return interaction.editReply({ content: 'No teams found for that tournament ID.' });
      }

      // =========================
      // LOAD EXISTING DATA
      // =========================

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_NAME}!A3:AX`,
      });

      const rows = (response.data.values || []).map((row) => [...row]);

      const playerMap = new Map();
      rows.forEach((row, i) => {
        const epicId = row[1];
        if (epicId && !playerMap.has(epicId)) {
          playerMap.set(epicId, i);
        }
      });

      const existingPenaltyKeys = await loadExistingPenaltyKeys(
        sheets,
        spreadsheetId
      );

      const newPenaltyRows = [];
      const addedPenaltyKeys = new Set();
      const seenThisRun = new Set();
      let totalPlayers = 0;
      let correctionsSkipped = 0;

      // =========================
      // APPLY YUNITE SCORES
      // =========================

      for (const team of teams) {
        const games = (team.gameList || [])
          .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
          .slice(0, 4)
          .map((g) => (g.score == null ? '' : g.score));

        while (games.length < 4) {
          games.push('');
        }

        const corrections = team.corrections || [];

        for (const user of team.users || []) {
          const epicId = user.epicId;
          if (!epicId || seenThisRun.has(epicId)) continue;

          seenThisRun.add(epicId);
          totalPlayers++;

          const username = user.name || 'Unknown';
          let rowIndex = playerMap.get(epicId);

          if (rowIndex === undefined) {
            rowIndex = rows.findIndex((r) => !r[1]);
            if (rowIndex === -1) {
              rowIndex = rows.length;
              rows.push([]);
            }
            playerMap.set(epicId, rowIndex);
          }

          const row = rows[rowIndex];
          row[0] = username;
          row[1] = epicId;
          row[startCol] = games[0];
          row[startCol + 1] = games[1];
          row[startCol + 2] = games[2];
          row[startCol + 3] = games[3];

          corrections.forEach((c, correctionIndex) => {
            if (!correctionTargetsUser(c, user)) return;

            const correctionId = correctionStableId(
              c,
              team,
              tournamentId,
              session,
              correctionIndex
            );
            const dedupKey = penaltyDedupKey(
              tournamentId,
              session,
              correctionId,
              epicId
            );

            if (
              existingPenaltyKeys.has(dedupKey) ||
              addedPenaltyKeys.has(dedupKey)
            ) {
              correctionsSkipped++;
              return;
            }

            addedPenaltyKeys.add(dedupKey);

            newPenaltyRows.push([
              c.timestamp || new Date().toISOString(),
              tournamentId,
              session,
              epicId,
              username,
              team.teamId,
              normalizePenaltyAmount(c.amount),
              c.reason || '',
              correctionId,
            ]);
          });
        }
      }

      // =========================
      // CLEAN ROWS
      // =========================

      const cleanRows = rows.map(padRow);

      // =========================
      // WRITE UPDATED DATA
      // =========================

      if (cleanRows.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${SHEET_NAME}!A3:AX`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: cleanRows },
        });
      }

      if (newPenaltyRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${PENALTIES_SHEET}!A:I`,
          valueInputOption: 'RAW',
          requestBody: { values: newPenaltyRows },
        });
      }

      await interaction.editReply({
        content:
          `Session ${session} submitted for tournament \`${tournamentId}\`.\n` +
          `${totalPlayers} players updated.\n` +
          `${newPenaltyRows.length} new penalties logged` +
          (correctionsSkipped
            ? ` (${correctionsSkipped} already on sheet for this session).`
            : '.'),
      });
    } catch (error) {
      console.error('submit error:', error);
      await interaction.editReply({
        content: `Failed to submit results: ${error.message}`,
      });
    }
  },
};
