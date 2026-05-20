const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { getSheets } = require("../lib/sheets");

const {
  getEventBanRows,
  writeEventBanRows,
  appendEventBanRow,
  batchUpdateEventBanRows,
  sheetRowNumber
} = require("../lib/eventBanSheet");

const {
  EVENT_BAN_TYPE_LABEL,
  syncEventBanRole
} = require("../lib/eventBanDiscord");

// ================= CONFIG =================

const SHEET_ID = process.env.MAIN_SHEET_ID;

const AUDIT_SHEET = "Audit Log";

const BAN_CHANNEL_ID = "1472795189515915466";

// ================= HELPERS =================

const today = () =>
  new Date().toLocaleDateString("en-GB");

function formatUser(text) {
  return `\`${text}\``;
}

function parseDateInput(str) {

  if (!str) return null;

  const iso =
    /^(\d{4})-(\d{2})-(\d{2})$/;

  const uk =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

  let match;

  if ((match = str.match(iso))) {

    const [, y, m, d] = match;

    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d)
    );

  }

  if ((match = str.match(uk))) {

    const [, d, m, y] = match;

    return new Date(
      Number(y),
      Number(m) - 1,
      Number(d)
    );

  }

  return null;

}

function getDaysRemaining(endDateStr) {

  const end =
    parseDateInput(endDateStr);

  if (!end) return 0;

  const now = new Date();

  now.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const diffMs = end - now;

  return Math.max(
    0,
    Math.ceil(
      diffMs /
      (1000 * 60 * 60 * 24)
    )
  );

}

// ================= SHEETS =================

const getRows = getEventBanRows;
const writeRows = writeEventBanRows;

async function logAudit(
  action,
  moderator,
  user = ""
) {

  try {

    const sheets = getSheets();

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${AUDIT_SHEET}!A2:D`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          today(),
          action,
          moderator.tag,
          user?.tag || user
        ]]
      }
    });

  } catch (err) {

    console.error(
      "AUDIT LOG ERROR:",
      err
    );

  }

}

// ================= FORMATTERS =================

const formatEventBan = r =>
`${r[1]} — ${r[2]} Event Ban
Started ${r[5]}
${r[4]} Events Remaining
Reason: ${r[7] || "No reason provided"}`;

const formatProbation = r =>
`${r[1]} — Probation
Started ${r[5]}
Ends ${r[6]}
${r[4]} Days Remaining
Reason: ${r[7] || "No reason provided"}`;

// ================= EXPIRED PROBATIONS =================

async function handleExpiredProbations(
  rows,
  banChannel
) {

  let updated = false;

  for (const r of rows) {

    if (r[2] !== "Probation")
      continue;

    const daysRemaining =
      getDaysRemaining(r[6]);

    if (Number(r[4]) === 0)
      continue;

    if (daysRemaining > 0)
      continue;

    r[4] = 0;

    updated = true;

    try {

      await banChannel.send(
        `🔔 PROBATION ENDED for ${formatUser(r[1])}`
      );

    } catch (err) {

      console.error(
        "PROBATION ENDED SEND ERROR:",
        err
      );

    }

  }

  return updated;

}

// ================= SIGNUP CHECKS (roletagged, etc.) =================

/**
 * Whether a user should be blocked from a signup for a given event.
 *
 * Ignores probation rows (probationers are not eligible to be tagged in signups).
 * Event bans: block when events remaining > 0.
 */
function getSignupBlockReason(userId, rows) {

  for (const r of rows) {

    if (r[0] !== userId) {
      continue;
    }

    if (r[2] === "Probation") {
      continue;
    }

    const remaining = Number(r[4] || 0);

    if (remaining <= 0) {
      continue;
    }

    return {
      kind: "event_ban",
      userId,
      tag: r[1],
      remaining
    };

  }

  return null;

}

function formatSignupBlockMessage(block) {

  if (!block) {
    return "";
  }

  const mention = block.userId
    ? `<@${block.userId}>`
    : (block.tag || "User");

  return (
    `${mention} has an active event ban ` +
    `(${block.remaining} event(s) remaining).`
  );

}

// ================= COMMAND =================

const eventBanCommand =
  new SlashCommandBuilder()

    .setName("eventban")

    .setDescription(
      "Manage event bans"
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageRoles
    )

    // ================= APPLY =================

    .addSubcommand(sub =>
      sub

        .setName("apply")

        .setDescription(
          "Apply an event ban"
        )

        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(true)
        )

        .addIntegerOption(option =>
          option
            .setName("events")
            .setDescription("Events")
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName("reason")
            .setDescription("Reason")
            .setRequired(true)
        )
    )

    // ================= PROBATION =================

    .addSubcommand(sub =>
      sub

        .setName("probation")

        .setDescription(
          "Apply probation"
        )

        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(true)
        )

        .addIntegerOption(option =>
          option
            .setName("days")
            .setDescription("Days")
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName("reason")
            .setDescription("Reason")
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName("start")
            .setDescription(
              "Start date YYYY-MM-DD or DD/MM/YYYY"
            )
            .setRequired(false)
        )
    )

    // ================= EVENT PASSED =================

    .addSubcommand(sub =>
      sub

        .setName("eventpassed")

        .setDescription(
          "Reduce remaining bans for all active event bans"
        )

        .addIntegerOption(option =>
          option
            .setName("events")
            .setDescription(
              "Number of events that passed"
            )
            .setRequired(true)
        )
    )

    // ================= SUMMARY =================

    .addSubcommand(sub =>
      sub

        .setName("summary")

        .setDescription(
          "Show active bans and probations"
        )
    )

    // ================= REMOVE =================

    .addSubcommand(sub =>
      sub

        .setName("remove")

        .setDescription(
          "Remove a user's event bans"
        )

        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    );

// ================= HANDLER =================

async function handleEventBan(
  interaction
) {

  await interaction.deferReply({
    ephemeral: true
  });

  try {

    const sub =
      interaction.options.getSubcommand();

    const rows =
      await getRows();

    const banChannel =
      await interaction.guild.channels.fetch(
        BAN_CHANNEL_ID
      );

    // ================= APPLY =================

    if (sub === "apply") {

      const user =
        interaction.options.getUser(
          "user"
        );

      const events =
        interaction.options.getInteger(
          "events"
        );

      const reason =
        interaction.options.getString(
          "reason"
        );

      const row = [
        user.id,
        user.tag,
        EVENT_BAN_TYPE_LABEL,
        events,
        events,
        today(),
        today(),
        reason,
        interaction.user.tag,
        ""
      ];

      const msg =
        await banChannel.send(
          formatEventBan(row)
        );

      row[9] = msg.id;

      await appendEventBanRow(row);

      rows.push(row);

      await syncEventBanRole(
        interaction.guild,
        user.id,
        rows
      );

      await logAudit(
        `Applied ${events}-event ban`,
        interaction.user,
        user
      );

      return interaction.editReply({
        content:
          "✅ Event ban applied."
      });

    }

    // ================= PROBATION =================

    if (sub === "probation") {

      const user =
        interaction.options.getUser(
          "user"
        );

      const days =
        interaction.options.getInteger(
          "days"
        );

      const reason =
        interaction.options.getString(
          "reason"
        );

      const startInput =
        interaction.options.getString(
          "start"
        );

      let startDate;

      if (startInput) {

        startDate =
          parseDateInput(
            startInput
          );

        if (!startDate) {

          return interaction.editReply({
            content:
              "❌ Invalid date format."
          });

        }

      } else {

        startDate = new Date();

      }

      const endDate =
        new Date(startDate);

      endDate.setDate(
        endDate.getDate() + days
      );

      const format = d =>
        d.toLocaleDateString(
          "en-GB"
        );

      const row = [
        user.id,
        user.tag,
        "Probation",
        days,
        days,
        format(startDate),
        format(endDate),
        reason,
        interaction.user.tag,
        ""
      ];

      const msg =
        await banChannel.send(
          formatProbation(row)
        );

      row[9] = msg.id;

      await appendEventBanRow(row);

      rows.push(row);

      await logAudit(
        `Applied ${days}-day probation`,
        interaction.user,
        user
      );

      return interaction.editReply({
        content:
          "✅ Probation applied."
      });

    }

    // ================= EVENT PASSED =================

    if (sub === "eventpassed") {

      const events =
        interaction.options.getInteger(
          "events"
        );

      const sheetUpdates = [];
      const usersToSync = new Set();

      for (let i = 0; i < rows.length; i++) {

        const r = rows[i];

        if (r[2] === "Probation") {
          continue;
        }

        if (Number(r[4]) <= 0) {
          continue;
        }

        r[4] = Math.max(
          0,
          Number(r[4]) - events
        );

        r[6] = today();

        sheetUpdates.push({
          sheetRow: sheetRowNumber(i),
          row: r
        });

        usersToSync.add(r[0]);

        if (r[9]) {

          try {

            const msg =
              await banChannel.messages.fetch(
                r[9]
              );

            await msg.edit(
              formatEventBan(r)
            );

          } catch {}

        }

      }

      await batchUpdateEventBanRows(sheetUpdates);

      for (const userId of usersToSync) {
        await syncEventBanRole(
          interaction.guild,
          userId,
          rows
        );
      }

      return interaction.editReply({
        content:
          `✅ Updated **${sheetUpdates.length}** event ban row(s).`
      });

    }

    // ================= SUMMARY =================

    if (sub === "summary") {

      const activeBans =
        rows.filter(
          r =>
            r[2] !== "Probation" &&
            Number(r[4]) > 0
        );

      const probations =
        rows.filter(
          r =>
            r[2] === "Probation" &&
            Number(r[4]) > 0
        );

      let text = "";

      text +=
        "**Active Event Bans**\n";

      text += activeBans.length
        ? activeBans.map(r =>
            `${r[1]} — ${r[4]} events remaining`
          ).join("\n")
        : "None";

      text +=
        "\n\n**Active Probations**\n";

      text += probations.length
        ? probations.map(r =>
            `${r[1]} — ${r[4]} days remaining (ends ${r[6]})`
          ).join("\n")
        : "None";

      return interaction.editReply({
        content:
          text.slice(0, 1900)
      });

    }

    // ================= REMOVE =================

    if (sub === "remove") {

      const user =
        interaction.options.getUser(
          "user"
        );

      const filtered =
        rows.filter(
          r => r[0] !== user.id
        );

      if (
        filtered.length === rows.length
      ) {

        return interaction.editReply({
          content:
            "❌ User not found."
        });

      }

      await writeRows(filtered);

      await syncEventBanRole(
        interaction.guild,
        user.id,
        filtered
      );

      await logAudit(
        "Removed Event Ban",
        interaction.user,
        user
      );

      return interaction.editReply({
        content:
          `✅ Removed all bans for ${user.tag}`
      });

    }

  } catch (err) {

    console.error(
      "EVENT BAN COMMAND ERROR:",
      err
    );

    return interaction.editReply({
      content:
        "❌ Failed to execute event ban command."
    });

  }

}

// ================= EXPORTS =================

module.exports = {
  eventBanCommand,
  handleEventBan,
  handleExpiredProbations,
  getRows,
  getSignupBlockReason,
  formatSignupBlockMessage
};