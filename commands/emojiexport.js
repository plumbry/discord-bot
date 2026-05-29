const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder
} = require("discord.js");

const MAX_FILE_BYTES = 8 * 1024 * 1024;

function serializeEmoji(emoji) {
  return {
    name: emoji.name,
    id: emoji.id,
    animated: Boolean(emoji.animated),
    url: emoji.imageURL({ size: 256 })
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("emojiexport")
    .setDescription(
      "Export all custom emojis to a JSON file for importing into another server"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions),

  async execute(interaction) {
    const guild = interaction.guild;

    if (!guild) {
      return interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true
      });
    }

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    let emojiCollection;

    try {
      emojiCollection = await guild.emojis.fetch();
    } catch (err) {
      console.error("[EMOJIEXPORT] fetch failed:", err?.message || err);
      return interaction.editReply(
        "Could not load server emojis. Try again later."
      );
    }

    const emojis = [...emojiCollection.values()].map(serializeEmoji);

    if (emojis.length === 0) {
      return interaction.editReply("This server has no custom emojis to export.");
    }

    const payload = {
      guild: { id: guild.id, name: guild.name },
      exportedAt: new Date().toISOString(),
      count: emojis.length,
      emojis
    };

    const body = JSON.stringify(payload, null, 2);
    const buffer = Buffer.from(body, "utf8");

    if (buffer.byteLength > MAX_FILE_BYTES) {
      return interaction.editReply(
        `Export is too large to upload (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB).`
      );
    }

    const safeGuildName =
      guild.name.replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "") ||
      "guild";

    const fileName = `emojis-${safeGuildName}-${
      new Date().toISOString().slice(0, 10)
    }.json`;

    const file = new AttachmentBuilder(buffer, { name: fileName });

    const animatedCount = emojis.filter(e => e.animated).length;
    const staticCount = emojis.length - animatedCount;

    await interaction.editReply({
      content:
        `Exported **${emojis.length}** emoji(s) ` +
        `(${staticCount} static, ${animatedCount} animated).\n` +
        "Run `/emojiimport` in the target server and attach this file.",
      files: [file]
    });
  }
};
