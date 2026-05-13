const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

module.exports = {

  data: new SlashCommandBuilder()

    .setName("dropmap")

    .setDescription(
      "Post dropmap closure message"
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    ),

  async execute(interaction) {

    try {

      await interaction.channel.send(
        "## DROPMAP CLOSED UNTIL NEXT GAME"
      );

      await interaction.reply({
        content: "✅ Dropmap closure posted.",
        ephemeral: true
      });

    } catch (err) {

      console.error(
        "❌ dropmap command error:"
      );

      console.error(err);

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await interaction.reply({
          content:
            "❌ Failed to post dropmap message.",
          ephemeral: true
        });

      }

    }

  }

};