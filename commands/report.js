const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Send instructions for submitting a rule break report")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {

    const message =
`If you're reporting a rule break from an in-game match, please include **clear evidence** so staff can properly review it.

**Accepted evidence:**
• Stream clips or VOD timestamps  
• Fortnite replay footage  
• Screenshots  
• Match IDs or lobby details  

**Your evidence should clearly show:**
• The **player's name**
• The **rule break occurring**
• Enough context for staff to understand what happened

Reports without evidence are very difficult for staff to review and may not be actioned.

Please upload your evidence directly in this ticket or thread so staff can investigate.`;

    await interaction.reply({
      content: message
    });
  }
};