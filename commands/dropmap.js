const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

async function postDropmapClosed(channel) {
  return channel.send(
    "## DROPMAP CLOSED UNTIL NEXT GAME"
  );
}

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

      await postDropmapClosed(interaction.channel);

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

module.exports.postDropmapClosed = postDropmapClosed;