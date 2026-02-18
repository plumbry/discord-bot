const { SlashCommandBuilder } = require("discord.js");

// ================= SLASH COMMAND =================
const verifyCommand = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Verify yourself");

// ================= VERIFY HANDLER =================
async function handleVerify(interaction) {
  /**
   * CRITICAL:
   * This MUST be the first thing that runs.
   * It guarantees editReply() is always safe.
   */
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  try {
    // -------------------------------
    // YOUR EXISTING VERIFY LOGIC
    // -------------------------------
    // Keep all of your current logic here.
    // Below is a safe placeholder pattern.

    // Example:
    // const roleId = "ROLE_ID_HERE";
    // const role = interaction.guild.roles.cache.get(roleId);
    // if (!role) {
    //   return interaction.editReply("❌ Verification role not found.");
    // }
    // await interaction.member.roles.add(role);

    await interaction.editReply("✅ You have been verified!");
  } catch (err) {
    console.error("Verify error:", err);

    // Even error paths are now safe
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(
        "❌ Verification failed. Please contact a moderator."
      );
    }
  }
}

// ================= WELCOME HANDLER =================
async function handleWelcome(member) {
  // Leave your existing welcome logic unchanged here
  // (This file only needed interaction lifecycle hardening)
}

module.exports = {
  verifyCommand,
  handleVerify,
  handleWelcome
};
