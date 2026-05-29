const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");
const axios = require("axios");

const CREATE_DELAY_MS = 1500;
const EMOJI_SLOTS_FULL = 30008;

const delay = ms => new Promise(r => setTimeout(r, ms));

function describeError(err) {
  if (err?.code === EMOJI_SLOTS_FULL) return "server emoji slots are full";
  return err?.rawError?.message || err?.message || "unknown error";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("emojiimport")
    .setDescription(
      "Recreate emojis in this server from a /emojiexport JSON file"
    )
    .addAttachmentOption(o =>
      o
        .setName("file")
        .setDescription("The JSON file produced by /emojiexport")
        .setRequired(true)
    )
    .addBooleanOption(o =>
      o
        .setName("skip_existing")
        .setDescription(
          "Skip emojis whose name already exists here (default: true)"
        )
        .setRequired(false)
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

    const attachment = interaction.options.getAttachment("file");
    const skipExisting = interaction.options.getBoolean("skip_existing") ?? true;

    let manifest;

    try {
      const res = await axios.get(attachment.url, { responseType: "text" });
      manifest =
        typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    } catch (err) {
      console.error("[EMOJIIMPORT] manifest load failed:", err?.message || err);
      return interaction.editReply(
        "Could not read or parse the attached file. Make sure it is a JSON file from `/emojiexport`."
      );
    }

    if (!manifest || !Array.isArray(manifest.emojis)) {
      return interaction.editReply(
        "That file does not look like a `/emojiexport` export (no `emojis` list found)."
      );
    }

    const emojis = manifest.emojis.filter(e => e && e.name && e.url);

    if (emojis.length === 0) {
      return interaction.editReply("The file contains no emojis to import.");
    }

    let existingNames;

    try {
      const current = await guild.emojis.fetch();
      existingNames = new Set([...current.values()].map(e => e.name));
    } catch (err) {
      console.error("[EMOJIIMPORT] existing fetch failed:", err?.message || err);
      existingNames = new Set();
    }

    await interaction.editReply(
      `Importing **${emojis.length}** emoji(s) into **${guild.name}**. This can take a while...`
    );

    const created = [];
    const skipped = [];
    const failed = [];
    let slotsFull = false;

    for (let i = 0; i < emojis.length; i++) {
      const emoji = emojis[i];

      if (skipExisting && existingNames.has(emoji.name)) {
        skipped.push(emoji.name);
        continue;
      }

      try {
        const imageRes = await axios.get(emoji.url, {
          responseType: "arraybuffer"
        });
        const imageBuffer = Buffer.from(imageRes.data);

        await guild.emojis.create({
          attachment: imageBuffer,
          name: emoji.name
        });

        created.push(emoji.name);
        existingNames.add(emoji.name);
      } catch (err) {
        const reason = describeError(err);
        failed.push({ name: emoji.name, reason });

        if (err?.code === EMOJI_SLOTS_FULL) {
          slotsFull = true;
          for (const remaining of emojis.slice(i + 1)) {
            failed.push({
              name: remaining.name,
              reason: "server emoji slots are full"
            });
          }
          break;
        }

        console.error(
          `[EMOJIIMPORT] failed to create ${emoji.name}:`,
          err?.message || err
        );
      }

      await delay(CREATE_DELAY_MS);
    }

    const lines = [
      `Import finished for **${guild.name}**:`,
      `- Created: **${created.length}**`,
      `- Skipped (already exist): **${skipped.length}**`,
      `- Failed: **${failed.length}**`
    ];

    if (slotsFull) {
      lines.push(
        "\nStopped early because this server's emoji slots are full. Boost the server for more slots, then re-run."
      );
    }

    if (failed.length > 0) {
      const sample = failed
        .slice(0, 10)
        .map(f => `\`${f.name}\` (${f.reason})`)
        .join(", ");
      lines.push(`\nFailures: ${sample}${failed.length > 10 ? ", ..." : ""}`);
    }

    await interaction.editReply(lines.join("\n"));
  }
};
