const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { getEventBanRows } = require("../lib/eventBanSheet");
const {
  rowHasActiveEventBan,
  rowHasActiveProbation,
  isOffenseRow,
  describeUserStatus
} = require("../lib/eventBanRoles");
const { processPendingRoleSyncs } = require("../banExpiryChecker");

const GUILD_ID =
  process.env.GUILD_ID || "1371615693392576580";

const getRows = getEventBanRows;

const eventBanCommand = new SlashCommandBuilder()
  .setName("eventban")
  .setDescription(
    "Event ban and probation roles (synced from coedzbd.com API)"
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand(sub =>
    sub
      .setName("sync")
      .setDescription(
        "Poll pending role syncs from the API and apply Discord roles now"
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("summary")
      .setDescription(
        "Show active bans and probations from the Event Bans sheet (read-only)"
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("status")
      .setDescription("Show sheet status for one user (read-only)")
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription("User to check")
          .setRequired(true)
      )
  );

async function handleEventBan(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const sub = interaction.options.getSubcommand();

    if (sub === "sync") {
      await processPendingRoleSyncs(interaction.client);

      return interaction.editReply({
        content:
          "✅ Processed pending role syncs (poll or push). " +
          "Check bot logs for details."
      });
    }

    const rows = await getRows();

    if (sub === "status") {
      const user = interaction.options.getUser("user");
      const status = describeUserStatus(user.id, rows);
      const parts = [];

      if (status.eventBan) {
        parts.push(
          `**Event ban:** ${status.eventBan.type} — ` +
            `${status.eventBan.remaining} event(s) remaining`
        );
      } else {
        parts.push("**Event ban:** None");
      }

      if (status.probation) {
        parts.push(
          `**Probation:** ${status.probation.type} — ` +
            `${status.probation.remaining} day(s) remaining (ends ${status.probation.ends || "—"})`
        );
      } else {
        parts.push("**Probation:** None");
      }

      if (status.offenses.length) {
        parts.push(
          `**Offense log(s):** ${status.offenses.length} on record (no ban role)`
        );
      }

      return interaction.editReply({
        content: parts.join("\n")
      });
    }

    if (sub === "summary") {
      const activeBans = rows.filter(rowHasActiveEventBan);
      const probations = rows.filter(rowHasActiveProbation);
      const offenseLogs = rows.filter(isOffenseRow);

      let text = "**Active event bans** (sheet)\n";
      text += activeBans.length
        ? activeBans
            .map(
              r => `${r[1]} — ${r[2]} (${r[4]} event(s) remaining)`
            )
            .join("\n")
        : "None";

      text += "\n\n**Active probations** (sheet)\n";
      text += probations.length
        ? probations
            .map(
              r =>
                `${r[1]} — ${r[4]} day(s) remaining (ends ${r[6] || "—"})`
            )
            .join("\n")
        : "None";

      text += `\n\n**Offense logs** (no ban role): ${offenseLogs.length}`;
      text +=
        "\n\n_Roles are applied via push from coedzbd.com API (startup drain + manual sync)._";

      return interaction.editReply({
        content: text.slice(0, 1900)
      });
    }
  } catch (err) {
    console.error("EVENT BAN COMMAND ERROR:", err);

    return interaction.editReply({
      content: "❌ Event ban command failed. Check bot logs."
    });
  }
}

module.exports = {
  eventBanCommand,
  handleEventBan,
  getRows,
  getSignupBlockReason: require("../lib/eventBanRoles").getSignupBlockReason,
  memberHasEventBanRole: require("../lib/eventBanRoles").memberHasEventBanRole,
  formatSignupBlockMessage:
    require("../lib/eventBanRoles").formatSignupBlockMessage
};
