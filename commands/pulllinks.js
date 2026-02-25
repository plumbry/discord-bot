const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder
} = require("discord.js");

// ================= CONFIG =================
const MAX_MESSAGES = 2000; // hard cap for safety
const LINK_REGEX = /(https?:\/\/[^\s]+)/gi;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("pulllinks")
    .setDescription("Pull all links from this channel into a text file")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const channel = interaction.channel;

    await interaction.reply("🔍 Scanning channel for links…");

    let lastId = null;
    let scanned = 0;
    const links = new Set();

    while (scanned < MAX_MESSAGES) {
      const messages = await channel.messages.fetch({
        limit: 100,
        before: lastId
      });

      if (messages.size === 0) break;

      for (const msg of messages.values()) {
        scanned++;

        const matches = msg.content.match(LINK_REGEX);
        if (matches) {
          matches.forEach(link => links.add(link));
        }
      }

      lastId = messages.last().id;
    }

    if (links.size === 0) {
      return interaction.editReply("ℹ️ No links found in this channel.");
    }

    // Build text file
    const content = [...links].join("\n");
    const buffer = Buffer.from(content, "utf8");

    const filename = `links-${channel.id}.txt`;
    const attachment = new AttachmentBuilder(buffer, { name: filename });

    await interaction.editReply({
      content: `🔗 **Links extracted**\nTotal unique links: **${links.size}**`,
      files: [attachment]
    });
  }
};