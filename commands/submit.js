const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { google } = require('googleapis');

// ===== CONFIG =====
const SPREADSHEET_ID = '1s7HVAHUgcBbZTXsIIy1O4PupNArzxv7s2USApVgqXKo';
const SHEET_NAME = 'Player_Scores';

const GUILD_ID = '1371615693392576580';
const YUNITE_API_KEY = 'dceb92dd-a9f4-441c-80ad-331c03e3a16b';

// BASE64 SERVICE ACCOUNT JSON (REQUIRED)
const GOOGLE_CREDS_BASE64 = 'ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIsCiAgInByb2plY3RfaWQiOiAiYXVndXN0LWNhc2NhZGUtMTI4NzIzIiwKICAicHJpdmF0ZV9rZXlfaWQiOiAiMzc3NTgxYjc1OTE3MTBjOTkxNjdjODExNWNmOGE0ZGVhMjMyYmYxNyIsCiAgInByaXZhdGVfa2V5IjogIi0tLS0tQkVHSU4gUFJJVkFURSBLRVktLS0tLVxuTUlJRXZBSUJBREFOQmdrcWhraUc5dzBCQVFFRkFBU0NCS1l3Z2dTaUFnRUFBb0lCQVFDVFQxUTdZbEJBNUNPT1xubHZKV0FZQ0xqblF4ZVF6YXJCTVVOLzREMWd3dHNSWFBDL2hLd20rbDR0VUR3SndTWWppMmJPTFN5ZzhsczRBRlxuQktFeWhpZ0hEbFF0Sis5SHF5YU1iMGJPNkVXQ0tta1pzMHI1cUx3Z2hSckFabW9XU29XblhJU3dob25kcjhNSVxuYW1tK1BrNVg0SGU3ZEtRb2NURjNXMW93aW5uN09RdFFnSjZvV0ZqZE9SeWdmeDlKblllWWgwM0pneFV3UVhYa1xuRHh3QUQ3ZjFhUnNDRHdlbVVGVmZ6bTErRkc2dllmK2M5Y3A1S0VwVlJFWUswK0o3YVpwZitzQTQ3cFlYeSt1d1xuT0VrWFlzN3BaZGUyTk9GeDF3SWlXS1VQUHVPbStDQzgvSCt3VEo2VHdSL2YxaFRuZ0dpR1JJdkdpM1JzZ3ZFRVxuam5DcWt4NjlBZ01CQUFFQ2dnRUFCQ3ZpYVpOcW9na2VmVkFHbm1zemVJQTVCOFR5N3J4TVhBTUw1VHJwK2JTWFxuNFZib1JJeGJVZ1MrM2M0clVwVkh5dGxXMWxEcUplU3BNdVhZZjJXYUpqMEFlRGpoeHozd1VsaTlBTDN3dmZOZlxuMU41UURnclByUHk5UkZ2WGFZM1pycmdVSlNyaUpqakViKzFuZjM5NTJNdUpTSEhRb09QaVdvd1NoK2tHbnUwSlxueHBDdUg1SURZdDFqQkJtNmVxRUNNTk9mZ09vSXNRSklRWGNNMVZiUTVKVmRCTTRPcjkrMEMveGFsTVRqMnBOTlxuSmlaU3pYeUxhMy9NeStCVitvc0NMN3A2UzAxelVaVmxCNC9RL0FvempqTFJwMlJaRGxOVzV3Y09ZMzlaV010WVxuZnhRZ1RITlBHOTc0L1d6cVJFK3oyU21JKzNVWmdENU1LTGZ4OExZQUlRS0JnUUREQTJFOXdoWE5Oem1JSmFIYVxuZHpHek9FbWtkampzZG5BeDU1UVhtaG5PV2dVWkRsRmNaRmZaVzZMbzllZkZaTkFHNWk3UFdaa2lKUStxT1pUVFxuTTVmcjJaVFpZRXdXQWJTOWxrdWp3aUZhMzB2UXhtQmtJYnN6RndadlJEbmhrdUxSdmNmRzVhUUgvZmswVTFoUFxub1BsVVNGVEY0WGVxMkViZW5rR002QlNGalFLQmdRREJZTnJGaW1UT3RLeTNKc2J2SEJ1U1J4MW45VURKajkwQVxuRDV6TGp0RTE1MUR2TVF2V2lSS1c5VWtxazJ1Ni83RUdHZXFaazlmMVFoVzI3QU1ZNkVXak5EVUZTd1pzY3BraFxuVXhQRTl3UEJwWDFBZEFDcFhLY2xha2NqNWlOOStsU0ozUHFrUUNBaGljcW05WUNZVERYbWZJS1NKT05JZG5HVlxubXNZQlRkazU4UUtCZ0R2UFdZK2JheHhaaDZlZUF4b0IzSmhlOXhjZHV5K3EwNVk2dEV6WTBubGJXcHpvcTBOdVxuOHhLUzdGQU91MXJySkhJNVByb1JmTW5nSEFIVlR6UEhheHpHeXNRd3FLVkhPS3U4NE00RXlENGFwaUlOOVpwQVxuVGkzSkxnd0tITVoyU21LUmxpZ0dYbHlsSkQxTUlwV3BoVTY0TUdmUVV1ZHZGYTFKVkVsbkZJUXhBb0dBRlVEeVxuNnBFNllTbWtiZ0RhRG4rMVhBOXE0UGtvcEw2bUdKS2V0aFM5VThKWHQrSlpIYncxQ2RodHNUdEF0TzNUWkF0SFxuS0pnQ1BWZUZFWFRCSm1TbytyWUxPY2kwTFFrdllXVkRIL3ZTTXQ5Z2M4d01JcEVuWWNwYmhVdVBEUktOWmhXZVxuaXB6dHF5SDgzdnJPcG02QjRoSS9PNWJJVURlTVpsZjdlVHM0SzlFQ2dZQTRSaUVnQWNRUVc4QTRsQXVIdWhjb1xuRnRIem1lSHYxS2dLcVVaaFNqbUpMM05pVUJhbG83ME5Ba2VySldyME5EMmw2ZzRXZnNJbHhtTTYxZFB0WlYxK1xuVHNMa2ZsS3NlcDUxMEljTXlVazA4d2ZtNnh4MkpzdXAvR0Z2cy9hbEpCdU5NSGhsbDVHMW5IT3dGcmRyclRDYVxuNk8wZ3kxUnBUaDNocS9NWWZGTlpWUT09XG4tLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tXG4iLAogICJjbGllbnRfZW1haWwiOiAiZGlzY29yZC1ib3Qtc2hlZXRzQGF1Z3VzdC1jYXNjYWRlLTEyODcyMy5pYW0uZ3NlcnZpY2VhY2NvdW50LmNvbSIsCiAgImNsaWVudF9pZCI6ICIxMTU3MjA1OTIwMTU4NzY1NjM1MjkiLAogICJhdXRoX3VyaSI6ICJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20vby9vYXV0aDIvYXV0aCIsCiAgInRva2VuX3VyaSI6ICJodHRwczovL29hdXRoMi5nb29nbGVhcGlzLmNvbS90b2tlbiIsCiAgImF1dGhfcHJvdmlkZXJfeDUwOV9jZXJ0X3VybCI6ICJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9vYXV0aDIvdjEvY2VydHMiLAogICJjbGllbnRfeDUwOV9jZXJ0X3VybCI6ICJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9yb2JvdC92MS9tZXRhZGF0YS94NTA5L2Rpc2NvcmQtYm90LXNoZWV0cyU0MGF1Z3VzdC1jYXNjYWRlLTEyODcyMy5pYW0uZ3NlcnZpY2VhY2NvdW50LmNvbSIsCiAgInVuaXZlcnNlX2RvbWFpbiI6ICJnb29nbGVhcGlzLmNvbSIKfQo=';

// ===== GOOGLE AUTH =====
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(
    Buffer.from(GOOGLE_CREDS_BASE64, 'base64').toString()
  ),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// ===== HELPER: SESSION COLUMN MAP =====
function getSessionColumns(sessionNumber) {
  // Each session = 4 columns
  // A = EpicID
  // B = Username
  // C onward = games

  const startColIndex = 2 + (sessionNumber - 1) * 4; // zero-based
  return [0, 1, startColIndex, startColIndex + 1, startColIndex + 2, startColIndex + 3];
}

// ===== COMMAND =====
module.exports = {
  data: new SlashCommandBuilder()
    .setName('submit')
    .setDescription('Submit Yunite leaderboard to sheet')
    .addStringOption(opt =>
      opt.setName('tournamentid')
        .setDescription('Yunite Tournament ID')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('session')
        .setDescription('Session number (1-12)')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply();

    try {
      const tournamentId = interaction.options.getString('tournamentid');
      const session = interaction.options.getInteger('session');

      if (session < 1 || session > 12) {
        return interaction.editReply('❌ Session must be between 1 and 12');
      }

      // ===== FETCH YUNITE DATA =====
      const url = `https://yunite.xyz/api/v3/guild/${GUILD_ID}/tournaments/${tournamentId}/leaderboard`;

      const response = await axios.get(url, {
        headers: {
          'Y-API-Key': YUNITE_API_KEY,
        },
      });

      const players = response.data?.players;

      if (!players || players.length === 0) {
        return interaction.editReply('❌ No players found from Yunite');
      }

      console.log(`Fetched ${players.length} players`);

      // ===== GET EXISTING SHEET DATA =====
      const sheetRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:AZ`,
      });

      const rows = sheetRes.data.values || [];

      // Map epicId -> row index
      const playerMap = new Map();

      rows.forEach((row, i) => {
        const epicId = row[0];
        if (epicId) {
          playerMap.set(epicId, i);
        }
      });

      const updates = [];

      const cols = getSessionColumns(session);

      // ===== PROCESS PLAYERS =====
      for (const p of players) {
        const epicId = p.epicId;
        const username = p.name;

        // Extract 4 games safely
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

        // Ensure row exists
        if (!rows[rowIndex]) rows[rowIndex] = [];

        const row = rows[rowIndex];

        // Fill base fields
        row[0] = epicId;
        row[1] = username;

        // Fill session game scores
        row[cols[2]] = games[0];
        row[cols[3]] = games[1];
        row[cols[4]] = games[2];
        row[cols[5]] = games[3];

        updates.push(row);
      }

      console.log(`Prepared ${updates.length} rows`);

      // ===== WRITE BACK =====
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: rows,
        },
      });

      await interaction.editReply(`✅ Submitted ${players.length} players for S${session}`);

    } catch (err) {
      console.error(err);

      await interaction.editReply(
        `❌ Error: ${err.response?.data?.error?.message || err.message}`
      );
    }
  },
};