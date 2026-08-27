const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require("discord.js");

const {
  inspectMember,
  formatJoinedDate,
  tournamentStatusLabel,
  yuniteMatchLabel,
  userCanPrune
} = require("../lib/inactivePrune");

const EMBED_COLOR = 0x5865f2;

function deny(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content });
  }

  return interaction.reply({ content, ephemeral: true });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("prunecheck")
    .setDescription("Check whether a member would be eligible for an inactivity prune")
    .addUserOption(option =>
      option
        .setName("member")
        .setDescription("Member to inspect")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("days")
        .setDescription("Minimum days since joining (default 30)")
        .setMinValue(1)
        .setMaxValue(3650)
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    if (!userCanPrune(interaction.member)) {
      return deny(
        interaction,
        "You need the existing ZBD staff/admin permission to use this command."
      );
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    const targetUser = interaction.options.getUser("member");
    const minAgeDays = interaction.options.getInteger("days") || 30;
    const member = await interaction.guild.members
      .fetch(targetUser.id)
      .catch(() => null);

    if (!member) {
      return interaction.editReply({
        content: "That user is not in this server."
      });
    }

    let result;

    try {
      result = await inspectMember(interaction.guild, member, {
        minAgeDays,
        invokerId: interaction.user.id
      });
    } catch (err) {
      console.error("[PRUNECHECK] failed:", err?.message || err);
      return interaction.editReply({
        content: `Check failed: ${err?.message || "unknown error"}`
      });
    }

    const record = result.record;
    const eligible = record.eligible;
    const resultLine = eligible
      ? "Eligible for inactivity prune"
      : "NOT safe to automatically prune";

    const embed = new EmbedBuilder()
      .setTitle(`Inactive Check: ${record.username}`)
      .setColor(eligible ? 0xed4245 : EMBED_COLOR)
      .setThumbnail(targetUser.displayAvatarURL())
      .setDescription(
        [
          `Joined: ${formatJoinedDate(record.joinedTimestamp)}`,
          `Server age: ${record.ageDays == null ? "Unknown" : `${record.ageDays} days`}`,
          `Interaction found: ${record.interacted ? "Yes" : "No"}`,
          `Tournament status: ${tournamentStatusLabel(record.tournamentStatus)}`,
          `Yunite/Epic match: ${yuniteMatchLabel(record.yuniteMatch)}`,
          `Protected role: ${record.protected ? "Yes" : "No"}`,
          record.tournamentStatus === "unknown"
            ? `Reason: ${record.tournamentReason}`
            : record.protected
              ? `Reason: ${record.protectedReason}`
              : record.interacted
                ? `Reason: ${record.interactionReason}`
                : "",
          "",
          `**Result: ${resultLine}**`
        ]
          .filter(Boolean)
          .join("\n")
      )
      .setFooter({
        text:
          "Interaction uses stored bot records only, not Discord message history."
      });

    await interaction.editReply({ embeds: [embed] });
  }
};
