const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const BULK_LIMIT = 100;
const BULK_DELAY_MS = 1500;
const SINGLE_DELETE_DELAY_MS = 1200;
const MAX_MESSAGES = 2000;
const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

const delay = ms => new Promise(r => setTimeout(r, ms));

module.exports = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete messages in this channel (Discord-safe)")
    .addStringOption(o =>
      o.setName("confirm")
        .setDescription('Type "CONFIRM" to proceed')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const confirm = interaction.options.getString("confirm");

    if (confirm !== "CONFIRM") {
      return interaction.reply({
        content: '❌ You must type **CONFIRM** to use this command.',
        ephemeral: true
      });
    }

    const channel = interaction.channel;

    await interaction.reply("🧹 Purging messages…");

    let deleted = 0;
    let skipped = 0;
    let lastId;

    while (deleted + skipped < MAX_MESSAGES) {
      const messages = await channel.messages.fetch({
        limit: BULK_LIMIT,
        before: lastId
      });

      if (messages.size === 0) break;

      lastId = messages.last().id;

      const bulk = messages.filter(
        m => Date.now() - m.createdTimestamp < FOURTEEN_DAYS
      );

      const old = messages.filter(
        m => !bulk.has(m.id)
      );

      if (bulk.size > 0) {
        try {
          await channel.bulkDelete(bulk, true);
          deleted += bulk.size;
        } catch {
          skipped += bulk.size;
        }
        await delay(BULK_DELAY_MS);
      }

      for (const msg of old.values()) {
        try {
          await msg.delete();
          deleted++;
        } catch {
          skipped++;
        }
        await delay(SINGLE_DELETE_DELAY_MS);
      }
    }

    await interaction.editReply(
      `✅ **Purge complete**\n` +
      `Deleted: **${deleted}** messages\n` +
      `Skipped/failed: **${skipped}**\n` +
      `Limit: ${MAX_MESSAGES}`
    );
  }
};