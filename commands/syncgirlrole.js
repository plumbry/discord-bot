const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const {
  isConfigured,
  loadGirlCache,
  backfillGirlRolesFromDiscord
} = require("../lib/girlRoleSheet");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("syncgirlrole")
    .setDescription(
      "Sync everyone with the Girl role on Discord into the Girl Role Google Sheet tab"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    if (!isConfigured()) {
      return interaction.reply({
        content:
          "❌ Google Sheets is not configured (need GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 and MAIN_SHEET_ID).",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      await loadGirlCache();
      const { scanned, added } = await backfillGirlRolesFromDiscord(
        interaction.guild
      );

      await interaction.editReply(
        `✅ Girl Role sheet sync complete.\n\n` +
          `Members with Girl role on Discord: **${scanned}**\n` +
          `New rows appended to sheet: **${added}**`
      );
    } catch (err) {
      console.error("[SYNCGIRLROLE]", err);
      await interaction.editReply("❌ Sync failed. Check bot logs.");
    }
  }
};
