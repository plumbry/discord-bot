const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { getSheets } = require("../lib/sheets");

// ================= CONSTANTS =================
const LOG_CHANNEL_ID = "1471082166535454780";
const SHEET_ID = process.env.MAIN_SHEET_ID;
const AUDIT_RANGE = "Audit Log!A:G";

const ROLE_DELAY_MS = 900;

// ================= HELPERS =================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const isoNow = () => new Date().toISOString();

async function logAudit(data) {
  await getSheets().spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: AUDIT_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        isoNow(),
        data.action,
        data.moderator.id,
        data.moderator.tag,
        "",
        "",
        data.context
      ]]
    }
  });
}

// ================= COMMAND =================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("roleclear")
    .setDescription("Remove a role from all members who have it")
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to remove from all members")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {

    if (!process.env.MAIN_SHEET_ID) {
      return interaction.reply({
        content: "MAIN_SHEET_ID is not configured.",
        ephemeral: true
      });
    }

    const role = interaction.options.getRole("role");
    const guild = interaction.guild;

    if (role.managed) {
      return interaction.reply({
        content: "This role is managed and cannot be removed.",
        ephemeral: true
      });
    }

    const botMember = await guild.members.fetchMe();

    if (role.position >= botMember.roles.highest.position) {
      return interaction.reply({
        content: "I cannot remove this role due to role hierarchy.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    await interaction.editReply("Fetching members with this role...");

    const allMembers = await guild.members.fetch();

    const members = allMembers
      .filter(m => m.roles.cache.has(role.id) && !m.user.bot)
      .map(m => m);

    if (members.length === 0) {
      return interaction.editReply({
        content: "No members currently have this role."
      });
    }

    await interaction.editReply(
      "Removing role from " + members.length + " members..."
    );

    let removed = 0;
    let failed = 0;

    for (const member of members) {
      try {
        if (!member.roles.cache.has(role.id)) continue;

        await member.roles.remove(role);
        removed++;

      } catch {
        failed++;
      }

      await delay(ROLE_DELAY_MS);
    }

    const result =
      "Role clear complete\n" +
      "Role: " + role.name + "\n" +
      "Removed from: " + removed + "\n" +
      "Failed/skipped: " + failed;

    await interaction.editReply(result);

    // ================= LOG CHANNEL =================

    try {
      const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID);

      await logChannel.send(
        "Role Cleared\n" +
        "Moderator: " + interaction.user.tag + "\n" +
        "Role: " + role.name + "\n" +
        "Removed from: " + removed
      );

    } catch {}

    // ================= SHEET AUDIT =================

    try {
      await logAudit({
        action: "ROLE_CLEAR",
        moderator: interaction.user,
        context:
          "role=" + role.id +
          " removed=" + removed +
          " failed=" + failed
      });

    } catch (err) {
      console.error("[ROLECLEAR AUDIT ERROR]", err);
    }
  }
};