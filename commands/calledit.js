const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const {
  activeCalls,
  formatGameCallMessage
} = require("./gamecall");

module.exports = {

  data: new SlashCommandBuilder()
    .setName("calledit")
    .setDescription(
      "Edit the active game call"
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    )

    .addStringOption(o =>
      o.setName("action")
        .setDescription("Action")
        .setRequired(true)
        .addChoices(
          {
            name: "Override Code",
            value: "override"
          },
          {
            name: "Stop Follow Ups",
            value: "stop"
          },
          {
            name: "Cancel Game Call",
            value: "cancel"
          }
        ))

    .addStringOption(o =>
      o.setName("code")
        .setDescription(
          "New game code"
        )
        .setRequired(false)
    ),

  async execute(interaction){

    const call =
      activeCalls.get(
        interaction.channel.id
      );

    if (!call){

      return interaction.reply({
        content:
          "❌ No active game call found.",
        ephemeral:true
      });

    }

    const action =
      interaction.options.getString(
        "action"
      );

    // ================= OVERRIDE =================

    if (action === "override"){

      const newCode =
        interaction.options.getString(
          "code"
        );

      if (!newCode){

        return interaction.reply({
          content:
            "❌ You must provide a new code.",
          ephemeral:true
        });

      }

      call.code = newCode;

      const msg =
        await interaction.channel.messages.fetch(
          call.messageId
        );

      await msg.edit(
        formatGameCallMessage({
          game: call.gameNumber,
          region: call.region,
          code: newCode,
          startLine: `GAME ${call.gameNumber} STARTING SOON`,
          roleMention: `<@&${call.roleId}>`
        })
      );

      return interaction.reply({
        content:
          `✅ Game code changed to ${newCode}`,
        ephemeral:true
      });

    }

    // ================= STOP FOLLOW UPS =================

    if (action === "stop"){

      clearTimeout(call.t1);
      clearTimeout(call.t2);

      activeCalls.delete(
        interaction.channel.id
      );

      return interaction.reply({
        content:
          "✅ Follow up messages stopped.",
        ephemeral:true
      });

    }

    // ================= CANCEL =================

    if (action === "cancel"){

      clearTimeout(call.t1);
      clearTimeout(call.t2);

      activeCalls.delete(
        interaction.channel.id
      );

      await interaction.channel.send(
        "❌ GAME CALL CANCELLED"
      );

      return interaction.reply({
        content:
          "✅ Game call cancelled.",
        ephemeral:true
      });

    }

  }

};