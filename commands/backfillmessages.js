const { SlashCommandBuilder, ChannelType } = require("discord.js");
const Database = require("better-sqlite3");

const db = new Database("./activity.db");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("backfillmessages")
    .setDescription("Scan server history and populate message counts"),

  async execute(interaction) {

    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;

    const channels = guild.channels.cache.filter(
      c => c.type === ChannelType.GuildText
    );

    const counts = new Map();

    for (const channel of channels.values()) {

      let lastId;

      while (true) {

        const messages = await channel.messages.fetch({
          limit: 100,
          before: lastId
        });

        if (!messages.size) break;

        for (const msg of messages.values()) {

          if (msg.author.bot) continue;

          counts.set(
            msg.author.id,
            (counts.get(msg.author.id) || 0) + 1
          );

        }

        lastId = messages.last().id;

      }

    }

    for (const [userId, count] of counts) {

      db.prepare(`
        INSERT INTO messages (userId, count)
        VALUES (?, ?)
        ON CONFLICT(userId)
        DO UPDATE SET count = count + ?
      `).run(userId, count, count);

    }

    interaction.editReply(
      `Backfill complete. Processed ${counts.size} users.`
    );

  }
};