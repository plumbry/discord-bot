const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder
} = require("discord.js");

const FETCH_LIMIT = 100;
const FETCH_DELAY_MS = 750;
const HARD_CAP = 50000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const delay = ms => new Promise(r => setTimeout(r, ms));

function serializeMessage(msg) {
  return {
    id: msg.id,
    author: {
      id: msg.author?.id || null,
      tag: msg.author?.tag || null,
      bot: Boolean(msg.author?.bot)
    },
    content: msg.content || "",
    createdAt: msg.createdAt ? msg.createdAt.toISOString() : null,
    editedAt: msg.editedAt ? msg.editedAt.toISOString() : null,
    attachments: [...msg.attachments.values()].map(a => ({
      name: a.name,
      url: a.url
    })),
    embeds: msg.embeds.length,
    reactions: [...msg.reactions.cache.values()].map(r => ({
      emoji: r.emoji.name,
      count: r.count
    }))
  };
}

function toCsvCell(value) {
  const str = String(value ?? "");
  return `"${str.replace(/"/g, '""')}"`;
}

function buildOutput(messages, format, channel) {
  if (format === "csv") {
    const header = [
      "id",
      "timestamp",
      "author_tag",
      "author_id",
      "content",
      "attachments"
    ].join(",");

    const rows = messages.map(m =>
      [
        toCsvCell(m.id),
        toCsvCell(m.createdAt),
        toCsvCell(m.author.tag),
        toCsvCell(m.author.id),
        toCsvCell(m.content),
        toCsvCell(m.attachments.map(a => a.url).join(" "))
      ].join(",")
    );

    return { ext: "csv", body: [header, ...rows].join("\n") };
  }

  if (format === "txt") {
    const lines = messages.map(m => {
      const stamp = m.createdAt || "unknown-time";
      const author = m.author.tag || "unknown";
      const atts = m.attachments.length
        ? `\n    [attachments] ${m.attachments.map(a => a.url).join(" ")}`
        : "";
      return `[${stamp}] ${author}: ${m.content}${atts}`;
    });

    const head = `# Export of #${channel.name} (${channel.id})\n# ${messages.length} message(s) — generated ${new Date().toISOString()}\n`;
    return { ext: "txt", body: `${head}\n${lines.join("\n")}` };
  }

  const payload = {
    channel: { id: channel.id, name: channel.name },
    exportedAt: new Date().toISOString(),
    count: messages.length,
    messages
  };

  return { ext: "json", body: JSON.stringify(payload, null, 2) };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("export")
    .setDescription("Export messages from a channel to a downloadable file")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel to export (defaults to this channel)")
        .setRequired(false)
    )
    .addIntegerOption(o =>
      o.setName("limit")
        .setDescription("Max messages to export (omit to export everything)")
        .setMinValue(1)
        .setMaxValue(HARD_CAP)
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName("format")
        .setDescription("Output file format (default plain text)")
        .addChoices(
          { name: "Plain text", value: "txt" },
          { name: "JSON", value: "json" },
          { name: "CSV (spreadsheet)", value: "csv" }
        )
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const channel =
      interaction.options.getChannel("channel") || interaction.channel;
    const limit = interaction.options.getInteger("limit");
    const format = interaction.options.getString("format") || "txt";

    if (!channel || typeof channel.messages?.fetch !== "function") {
      return interaction.reply({
        content: "❌ That channel does not support message history.",
        ephemeral: true
      });
    }

    const me = interaction.guild?.members?.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (
      perms &&
      !perms.has(PermissionFlagsBits.ReadMessageHistory)
    ) {
      return interaction.reply({
        content: `❌ I don't have **Read Message History** permission in <#${channel.id}>.`,
        ephemeral: true
      });
    }

    await interaction.reply({
      content: `📥 Exporting messages from <#${channel.id}>…`,
      ephemeral: true
    });

    const collected = [];
    let lastId;

    try {
      while (collected.length < (limit || HARD_CAP)) {
        const remaining = (limit || HARD_CAP) - collected.length;
        const batchSize = Math.min(FETCH_LIMIT, remaining);

        const batch = await channel.messages.fetch({
          limit: batchSize,
          before: lastId
        });

        if (batch.size === 0) break;

        for (const msg of batch.values()) {
          collected.push(serializeMessage(msg));
        }

        lastId = batch.last().id;

        if (batch.size < batchSize) break;

        await delay(FETCH_DELAY_MS);
      }
    } catch (err) {
      console.error("[EXPORT] fetch error:", err?.message || err);
      return interaction.editReply(
        "❌ Failed while fetching messages. Please try again with a smaller limit."
      );
    }

    if (collected.length === 0) {
      return interaction.editReply("⚠️ No messages found to export.");
    }

    collected.reverse();

    const { ext, body } = buildOutput(collected, format, channel);
    const buffer = Buffer.from(body, "utf8");

    if (buffer.byteLength > MAX_FILE_BYTES) {
      return interaction.editReply(
        `⚠️ Export is too large to upload (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB). ` +
          `Re-run with a smaller \`limit\`.`
      );
    }

    const safeName = (channel.name || "channel").replace(/[^a-z0-9_-]/gi, "_");
    const file = new AttachmentBuilder(buffer, {
      name: `export-${safeName}-${Date.now()}.${ext}`
    });

    await interaction.editReply({
      content: `✅ Exported **${collected.length}** message(s) from <#${channel.id}>.`,
      files: [file]
    });
  }
};
