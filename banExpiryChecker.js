const {
  getEventBanRows,
  writeEventBanRows,
  batchUpdateEventBanRows,
  sheetRowNumber
} = require("./lib/eventBanSheet");

const { syncEventBanRole } = require("./lib/eventBanDiscord");

const BAN_CHANNEL_ID = "1472795189515915466";
const GUILD_ID =
  process.env.GUILD_ID || "1371615693392576580";

let checkerRunning = false;

function parseDateGB(str) {

  if (!str) {
    return null;
  }

  const [d, m, y] = str.split("/").map(Number);

  if (!d || !m || !y) {
    return null;
  }

  return new Date(y, m - 1, d);

}

async function checkBanExpiries(client) {

  if (checkerRunning) {
    return;
  }

  checkerRunning = true;

  try {

    const rows = await getEventBanRows();
    const channel = await client.channels.fetch(BAN_CHANNEL_ID);
    const guild =
      await client.guilds.fetch(GUILD_ID).catch(() => null);

    const now = new Date();
    const sheetUpdates = [];
    const usersToSync = new Set();

    for (let i = 0; i < rows.length; i++) {

      const r = rows[i];
      const type = r[2];
      const remaining = Number(r[4] || 0);
      const endDate = parseDateGB(r[6]);
      const messageId = r[9];
      const alerted = r[10] === "ENDED";

      if (alerted) {
        continue;
      }

      let ended = false;
      let label = "";

      if (type !== "Probation" && remaining === 0) {
        ended = true;
        label = "BAN ENDED";
      }

      if (type === "Probation" && endDate && endDate < now) {
        ended = true;
        label = "PROBATION ENDED";
      }

      if (!ended) {
        continue;
      }

      try {

        if (messageId) {

          const msg = await channel.messages.fetch(messageId);

          await msg.edit(
            msg.content + `\n\n✅ **${label}**`
          );

        }

        await channel.send(
          `🔔 **${label}** for **${r[1]}**`
        );

      } catch (err) {
        console.error("Failed updating message:", err);
      }

      r[10] = "ENDED";

      sheetUpdates.push({
        sheetRow: sheetRowNumber(i),
        row: r
      });

      if (type !== "Probation" && r[0]) {
        usersToSync.add(r[0]);
      }

    }

    if (sheetUpdates.length) {
      await batchUpdateEventBanRows(sheetUpdates);
    }

    if (guild) {

      for (const userId of usersToSync) {
        await syncEventBanRole(guild, userId, rows);
      }

    }

  } finally {
    checkerRunning = false;
  }

}

function startBanExpiryChecker(client) {

  const intervalMs = 5 * 60 * 1000;

  setTimeout(() => {
    checkBanExpiries(client).catch(console.error);
  }, 60 * 1000);

  setInterval(() => {
    checkBanExpiries(client).catch(console.error);
  }, intervalMs);

}

module.exports = {
  startBanExpiryChecker
};
