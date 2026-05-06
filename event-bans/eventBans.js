const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { google } = require("googleapis");

// ================= CONFIG =================

const SHEET_ID = process.env.MAIN_SHEET_ID;

const EVENT_SHEET = "Event Bans";
const AUDIT_SHEET = "Audit Log";

const BAN_CHANNEL_ID = "1472795189515915466";

// ================= GOOGLE AUTH =================

const credentials = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets"
  ]
});

const sheets = google.sheets({
  version: "v4",
  auth
});

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

async function getRows() {

  try {

    const res =
      await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${EVENT_SHEET}!A2:J`
      });

    return res.data.values || [];

  } catch (err) {

    console.error(
      "GET ROWS ERROR:",
      err
    );

    return [];

  }

}

async function writeRows(rows) {

  try {

    await sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: `${EVENT_SHEET}!A2:J`
    });

    if (rows.length) {

      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${EVENT_SHEET}!A2:J`,
        valueInputOption: "RAW",
        requestBody: {
          values: rows
        }
      });

    }

  } catch (err) {

    console.error(
      "WRITE ROWS ERROR:",
      err
    );

  }

}

async function logAudit(
  action,
  moderator,
  user = ""
) {

  try {

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

    .addSubcommand(sub =>
      sub

        .setName("add")

        .setDescription(
          "Add an event ban"
        )

        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName("type")
            .setDescription("Ban type")
            .setRequired(true)
            .addChoices(
              {
                name: "Ban",
                value: "Ban"
              },
              {
                name: "Probation",
                value: "Probation"
              }
            )
        )

        .addStringOption(option =>
          option
            .setName("reason")
            .setDescription("Reason")
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName("enddate")
            .setDescription(
              "End date DD/MM/YYYY"
            )
            .setRequired(false)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription(
          "List active bans"
        )
    )

    .addSubcommand(sub =>
      sub

        .setName("remove")

        .setDescription(
          "Remove an event ban"
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

    const subcommand =
      interaction.options.getSubcommand();

    const banChannel =
      interaction.guild.channels.cache.get(
        BAN_CHANNEL_ID
      );

    let rows =
      await getRows();

    // ================= ADD =================

    if (subcommand === "add") {

      const user =
        interaction.options.getUser(
          "user"
        );

      const type =
        interaction.options.getString(
          "type"
        );

      const reason =
        interaction.options.getString(
          "reason"
        );

      const endDate =
        interaction.options.getString(
          "enddate"
        ) || "";

      rows.push([
        today(),
        user.tag,
        type,
        reason,
        1,
        interaction.user.tag,
        endDate,
        "",
        "",
        ""
      ]);

      await writeRows(rows);

      await logAudit(
        `Added ${type}`,
        interaction.user,
        user
      );

      if (banChannel) {

        await banChannel.send(
          `🚫 ${formatUser(user.tag)}\nType: ${type}\nReason: ${reason}`
        );

      }

      return interaction.editReply({
        content:
          `✅ ${user.tag} added to event bans`
      });

    }

    // ================= LIST =================

    if (subcommand === "list") {

      if (!rows.length) {

        return interaction.editReply({
          content:
            "No active bans."
        });

      }

      const text = rows
        .map(r =>
          `• ${r[1]} — ${r[2]} — ${r[3]}`
        )
        .join("\n");

      return interaction.editReply({
        content:
          text.slice(0, 1900)
      });

    }

    // ================= REMOVE =================

    if (subcommand === "remove") {

      const user =
        interaction.options.getUser(
          "user"
        );

      const originalLength =
        rows.length;

      rows = rows.filter(
        r => r[1] !== user.tag
      );

      if (
        rows.length ===
        originalLength
      ) {

        return interaction.editReply({
          content:
            "❌ User not found."
        });

      }

      await writeRows(rows);

      await logAudit(
        "Removed Event Ban",
        interaction.user,
        user
      );

      return interaction.editReply({
        content:
          `✅ Removed event ban for ${user.tag}`
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
  handleExpiredProbations
};