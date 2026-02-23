const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");
const { google } = require("googleapis");

// ================= CONSTANTS =================
const LOG_CHANNEL_ID = "1471082166535454780";
const SHEET_ID = "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM";
const AUDIT_RANGE = "Audit Log!A:G";

const ROLE_DELAY_MS = 900;

// ================= GOOGLE SHEETS =================
const credentials = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// ================= HELPERS =================
const delay = ms => new Promise(r => setTimeout(r, ms));
const isoNow = () => new Date().toISOString();

async function logAudit({ action, moderator, context }) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: AUDIT_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        isoNow(),
        action,
        moderator.id,
        moderator.tag,
        "",
        "",
        context
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
    const role = interaction.options.getRole("role");
    const guild = interaction.guild;

    // ===== SAFETY CHECKS =====
    if (role.managed) {
      return interaction.reply({
        content: "❌ This role is managed by an integration and cannot be removed.",
        ephemeral: true
      });
    }

    const botMember = await guild.members.fetchMe();

    if (role.position >= botMember.roles.highest.position) {
      return interaction.reply({
        content: "❌ I cannot remove this role because it is equal to or higher than my highest role.",
        ephemeral: true
      });
    }

    // ✅ FETCH ALL MEMBERS (prevents stale role.members)
    await guild.members.fetch();

    const members = [...role.members.values()].filter(m => !m.user.bot);

    if (members.length === 0) {
      return interaction.reply({
        content: "ℹ️ No members currently have this role.",
        ephemeral: true
      });
    }

    // ✅ DEFER TO PREVENT TIMEOUT
    await interaction.deferReply({ ephemeral: true });

    await interaction.editReply(
      `⏳ Removing ${role} from **${members.length}** members…`
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
      `✅ **Role clear complete**\n` +
      `Role: ${role}\n` +
      `Removed from: **${removed}** members\n` +
      `Failed/skipped: **${failed}**`;

    await interaction.editReply(result);

    // Log channel
    try {
      const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID);
      await logChannel.send(
        `🏷️ **Role Cleared**\n` +
        `Moderator: ${interaction.user.tag}\n` +
        `Role: ${role}\n` +
        `Removed from: **${removed}** members`
      );
    } catch {}

    // Audit log
    try {
      await logAudit({
        action: "ROLE_CLEAR",
        moderator: interaction.user,
        context: `role=${role.id} removed=${removed} failed=${failed}`
      });
    } catch (err) {
      console.error("[ROLECLEAR AUDIT ERROR]", err);
    }
  }
};