const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Send reporting instructions for rule breaks")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {

    const message =
`If you're reporting a rule break, please make sure to include **clear evidence** so staff can properly review it.

**Accepted evidence includes:**
• Stream clips or VOD timestamps  
• Fortnite replay footage  
• Screenshots  

**Your evidence should clearly show:**
• The **player's name**
• The **rule break occurring**
• Enough context for staff to understand what happened

Reports without evidence are extremely difficult for staff to review and may not be actioned.

Please send your evidence in this ticket or thread so we can investigate properly.`;

    await interaction.reply({
      content: message,
      ephemeral: true
    });
  }
};