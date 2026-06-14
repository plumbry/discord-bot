const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");
const { openInGameReportTicket } = require("../lib/ticketTool");

const GUILD_ID =
  process.env.GUILD_ID || "1371615693392576580";

const CREATE_TICKET_CHANNEL_ID =
  process.env.TICKET_TOOL_INGAME_NEW_CHANNEL_ID ||
  process.env.CREATE_TICKET_CHANNEL_ID ||
  "1371651766407532654";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription(
      "Open an In Game Report ticket via Ticket Tool (run from a staff channel)"
    )
    .addUserOption(o =>
      o
        .setName("user")
        .setDescription("Ticket owner (the player this ticket is for)")
        .setRequired(true)
    )
    .addStringOption(o =>
      o
        .setName("reason")
        .setDescription("Optional reason passed to Ticket Tool ({reason})")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason");

    try {
      const ticketChannel = await openInGameReportTicket(
        interaction.client,
        {
          guildId: GUILD_ID,
          userId: user.id,
          reason,
          triggerChannelId: CREATE_TICKET_CHANNEL_ID,
          categoryId:
            process.env.TICKET_TOOL_INGAME_CATEGORY_ID || "",
          apiKey: process.env.TICKET_TOOL_API_KEY || "",
          panelId: process.env.TICKET_TOOL_INGAME_PANEL_ID || "",
          helperBotId: interaction.client.user.id
        }
      );

      return interaction.editReply({
        content:
          `✅ In Game Report ticket opened for <@${user.id}>.\n` +
          `Channel: ${ticketChannel}\n` +
          `https://discord.com/channels/${GUILD_ID}/${ticketChannel.id}`
      });
    } catch (err) {
      console.error("[TICKET]", err);

      return interaction.editReply({
        content: `❌ ${err?.message || "Failed to open In Game Report ticket."}`
      });
    }
  }
};
