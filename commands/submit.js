const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const { google } = require('googleapis');

// ===== CONFIG =====
const SPREADSHEET_ID = '1s7HVAHUgcBbZTXsIIy1O4PupNArzxv7s2USApVgqXKo';
const SHEET_NAME = 'Player_Scores';

const GUILD_ID = '1371615693392576580';
const YUNITE_API_KEY = 'dceb92dd-a9f4-441c-80ad-331c03e3a16b';

// 🔴 REQUIRED: your Base64 string
const GOOGLE_CREDS_BASE64 = 'ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIsCiAgInByb2plY3RfaWQiOiAiYXVndXN0LWNhc2NhZGUtMTI4NzIzIiwKICAicHJpdmF0ZV9rZXlfaWQiOiAiMzc3NTgxYjc1OTE3MTBjOTkxNjdjODExNWNmOGE0ZGVhMjMyYmYxNyIsCiAgInByaXZhdGVfa2V5IjogIi0tLS0tQkVHSU4gUFJJVkFURSBLRVktLS0tLVxuTUlJRXZBSUJBREFOQmdrcWhraUc5dzBCQVFFRkFBU0NCS1l3Z2dTaUFnRUFBb0lCQVFDVFQxUTdZbEJBNUNPT1xubHZKV0FZQ0xqblF4ZVF6YXJCTVVOLzREMWd3dHNSWFBDL2hLd20rbDR0VUR3SndTWWppMmJPTFN5ZzhsczRBRlxuQktFeWhpZ0hEbFF0Sis5SHF5YU1iMGJPNkVXQ0tta1pzMHI1cUx3Z2hSckFabW9XU29XblhJU3dob25kcjhNSVxuYW1tK1BrNVg0SGU3ZEtRb2NURjNXMW93aW5uN09RdFFnSjZvV0ZqZE9SeWdmeDlKblllWWgwM0pneFV3UVhYa1xuRHh3QUQ3ZjFhUnNDRHdlbVVGVmZ6bTErRkc2dllmK2M5Y3A1S0VwVlJFWUswK0o3YVpwZitzQTQ3cFlYeSt1d1xuT0VrWFlzN3BaZGUyTk9GeDF3SWlXS1VQUHVPbStDQzgvSCt3VEo2VHdSL2YxaFRuZ0dpR1JJdkdpM1JzZ3ZFRVxuam5DcWt4NjlBZ01CQUFFQ2dnRUFCQ3ZpYVpOcW9na2VmVkFHbm1zemVJQTVCOFR5N3J4TVhBTUw1VHJwK2JTWFxuNFZib1JJeGJVZ1MrM2M0clVwVkh5dGxXMWxEcUplU3BNdVhZZjJXYUpqMEFlRGpoeHozd1VsaTlBTDN3dmZOZlxuMU41UURnclByUHk5UkZ2WGFZM1pycmdVSlNyaUpqakViKzFuZjM5NTJNdUpTSEhRb09QaVdvd1NoK2tHbnUwSlxueHBDdUg1SURZdDFqQkJtNmVxRUNNTk9mZ09vSXNRSklRWGNNMVZiUTVKVmRCTTRPcjkrMEMveGFsTVRqMnBOTlxuSmlaU3pYeUxhMy9NeStCVitvc0NMN3A2UzAxelVaVmxCNC9RL0FvempqTFJwMlJaRGxOVzV3Y09ZMzlaV010WVxuZnhRZ1RITlBHOTc0L1d6cVJFK3oyU21JKzNVWmdENU1LTGZ4OExZQUlRS0JnUUREQTJFOXdoWE5Oem1JSmFIYVxuZHpHek9FbWtkampzZG5BeDU1UVhtaG5PV2dVWkRsRmNaRmZaVzZMbzllZkZaTkFHNWk3UFdaa2lKUStxT1pUVFxuTTVmcjJaVFpZRXdXQWJTOWxrdWp3aUZhMzB2UXhtQmtJYnN6RndadlJEbmhrdUxSdmNmRzVhUUgvZmswVTFoUFxub1BsVVNGVEY0WGVxMkViZW5rR002QlNGalFLQmdRREJZTnJGaW1UT3RLeTNKc2J2SEJ1U1J4MW45VURKajkwQVxuRDV6TGp0RTE1MUR2TVF2V2lSS1c5VWtxazJ1Ni83RUdHZXFaazlmMVFoVzI3QU1ZNkVXak5EVUZTd1pzY3BraFxuVXhQRTl3UEJwWDFBZEFDcFhLY2xha2NqNWlOOStsU0ozUHFrUUNBaGljcW05WUNZVERYbWZJS1NKT05JZG5HVlxubXNZQlRkazU4UUtCZ0R2UFdZK2JheHhaaDZlZUF4b0IzSmhlOXhjZHV5K3EwNVk2dEV6WTBubGJXcHpvcTBOdVxuOHhLUzdGQU91MXJySkhJNVByb1JmTW5nSEFIVlR6UEhheHpHeXNRd3FLVkhPS3U4NE00RXlENGFwaUlOOVpwQVxuVGkzSkxnd0tITVoyU21LUmxpZ0dYbHlsSkQxTUlwV3BoVTY0TUdmUVV1ZHZGYTFKVkVsbkZJUXhBb0dBRlVEeVxuNnBFNllTbWtiZ0RhRG4rMVhBOXE0UGtvcEw2bUdKS2V0aFM5VThKWHQrSlpIYncxQ2RodHNUdEF0TzNUWkF0SFxuS0pnQ1BWZUZFWFRCSm1TbytyWUxPY2kwTFFrdllXVkRIL3ZTTXQ5Z2M4d01JcEVuWWNwYmhVdVBEUktOWmhXZVxuaXB6dHF5SDgzdnJPcG02QjRoSS9PNWJJVURlTVpsZjdlVHM0SzlFQ2dZQTRSaUVnQWNRUVc4QTRsQXVIdWhjb1xuRnRIem1lSHYxS2dLcVVaaFNqbUpMM05pVUJhbG83ME5Ba2VySldyME5EMmw2ZzRXZnNJbHhtTTYxZFB0WlYxK1xuVHNMa2ZsS3NlcDUxMEljTXlVazA4d2ZtNnh4MkpzdXAvR0Z2cy9hbEpCdU5NSGhsbDVHMW5IT3dGcmRyclRDYVxuNk8wZ3kxUnBUaDNocS9NWWZGTlpWUT09XG4tLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tXG4iLAogICJjbGllbnRfZW1haWwiOiAiZGlzY29yZC1ib3Qtc2hlZXRzQGF1Z3VzdC1jYXNjYWRlLTEyODcyMy5pYW0uZ3NlcnZpY2VhY2NvdW50LmNvbSIsCiAgImNsaWVudF9pZCI6ICIxMTU3MjA1OTIwMTU4NzY1NjM1MjkiLAogICJhdXRoX3VyaSI6ICJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20vby9vYXV0aDIvYXV0aCIsCiAgInRva2VuX3VyaSI6ICJodHRwczovL29hdXRoMi5nb29nbGVhcGlzLmNvbS90b2tlbiIsCiAgImF1dGhfcHJvdmlkZXJfeDUwOV9jZXJ0X3VybCI6ICJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9vYXV0aDIvdjEvY2VydHMiLAogICJjbGllbnRfeDUwOV9jZXJ0X3VybCI6ICJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9yb2JvdC92MS9tZXRhZGF0YS94NTA5L2Rpc2NvcmQtYm90LXNoZWV0cyU0MGF1Z3VzdC1jYXNjYWRlLTEyODcyMy5pYW0uZ3NlcnZpY2VhY2NvdW50LmNvbSIsCiAgInVuaXZlcnNlX2RvbWFpbiI6ICJnb29nbGVhcGlzLmNvbSIKfQo=';

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

// ===== SESSION COLUMN HELPER =====
function getSessionStartColumn(session) {
  return 2 + (session - 1) * 4; // A=0, B=1, so games start at 2
}

// ===== COMMAND =====
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
    console.log('DEFERRED OK');

    try {
      // ===== INPUT =====
      const tournamentId = interaction.options.getString('tournamentid');
      const session = interaction.options.getInteger('session');

      console.log('INPUT:', { tournamentId, session });

      if (!tournamentId || !session) {
        return interaction.editReply('❌ Missing inputs');
      }

      // ===== FETCH YUNITE =====
      console.log('STEP 1: Fetching Yunite');

      const url = `https://yunite.xyz/api/v3/guild/${GUILD_ID}/tournaments/${tournamentId}/leaderboard`;

      const response = await axios.get(url, {
        headers: {
          'Y-API-Key': YUNITE_API_KEY,
        },
      });

      console.log('STEP 2: Yunite response received');

      // 🔴 FLEXIBLE PARSE (handles different formats)
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

      // ===== PROCESS DATA =====
      console.log('STEP 5: Processing players');

      for (const p of players) {
        const epicId = p.epicId || p.id;
        const username = p.name || p.username || 'Unknown';

        if (!epicId) {
          console.log('Skipping player with no epicId:', p);
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