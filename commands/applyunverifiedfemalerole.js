const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { GIRL_ROLE_ID } = require("../lib/memberProfile");
const { loadGenderEvalCache } = require("../lib/genderEvalSheet");
const {
  FEMALE_PENDING_ROLE_ID,
  applyFemalePendingRoleBackfill
} = require("../lib/femalePendingRole");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("applyunverifiedfemalerole")
    .setDescription(
      "Manual backfill: pending female role from Mod Log Gender Sheet (gender 50)"
    )
    .addBooleanOption(option =>
      option
        .setName("dry_run")
        .setDescription("Preview matches without assigning roles")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const dryRun = interaction.options.getBoolean("dry_run") ?? false;
    const guild = interaction.guild;

    await interaction.deferReply({ ephemeral: true });

    try {
      await loadGenderEvalCache();
    } catch (err) {
      console.error("[APPLY UNVERIFIED FEMALE ROLE]", err);
      return interaction.editReply(
        "Failed to load Mod Log Gender Sheet. Check GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 and sheet access."
      );
    }

    let stats;

    try {
      stats = await applyFemalePendingRoleBackfill(guild, null, {
        dryRun
      });
    } catch (err) {
      return interaction.editReply(err?.message || "Backfill failed.");
    }

    const verifiedRole = guild.roles.cache.get(GIRL_ROLE_ID);
    const {
      evaluatedOnSite,
      alreadyVerified,
      verifiedOnSheet = 0,
      alreadyPending,
      notInGuild,
      applied,
      failed,
      appliedSamples
    } = stats;

    let message =
      `${dryRun ? "Dry run" : "Role assignment"} complete.\n\n` +
      `Gender Sheet entries (gender 50): **${evaluatedOnSite}**\n` +
      `Already have Girl verified role: **${alreadyVerified}**\n` +
      `Girl verified on sheet (skipped): **${verifiedOnSheet}**\n` +
      `Already have pending role: **${alreadyPending}**\n` +
      `Not in this server: **${notInGuild}**\n` +
      `${dryRun ? "Would assign" : "Assigned"}: **${applied}**\n` +
      `Failed: **${failed}**\n\n` +
      `Pending role: <@&${FEMALE_PENDING_ROLE_ID}>\n` +
      `Verified role skipped: <@&${GIRL_ROLE_ID}>`;

    if (verifiedRole) {
      message += ` (${verifiedRole.name})`;
    }

    if (appliedSamples.length) {
      message +=
        `\n\n${dryRun ? "Would assign to" : "Assigned to"} (sample):\n` +
        appliedSamples.map(tag => `• ${tag}`).join("\n");

      const remaining = applied - appliedSamples.length;

      if (remaining > 0) {
        message += `\n… and **${remaining}** more`;
      }
    }

    await interaction.editReply(message);
  }
};
