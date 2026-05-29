const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder
} = require("discord.js");

const FETCH_LIMIT = 100;
const FETCH_DELAY_MS = 350;
const HARD_CAP = 200000;
const FILES_PER_MESSAGE = 10;

// Discord per-file upload limits by server boost tier. We aim slightly under
// the real ceiling to leave room for multipart/encoding overhead.
const MB = 1024 * 1024;
const UPLOAD_LIMIT_BY_TIER = {
  0: 10 * MB,
  1: 10 * MB,
  2: 50 * MB,
  3: 100 * MB
};
const SAFETY_MARGIN = 0.95;

function maxFileBytesFor(guild) {
  const tier = guild?.premiumTier ?? 0;
  const limit = UPLOAD_LIMIT_BY_TIER[tier] ?? UPLOAD_LIMIT_BY_TIER[0];
  return Math.floor(limit * SAFETY_MARGIN);
}

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

function buildOutput(messages, format, channel, part) {
  const partLabel = part ? ` (part ${part.index}/${part.total})` : "";

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

    const head = `# Export of #${channel.name} (${channel.id})${partLabel}\n# ${messages.length} message(s) — generated ${new Date().toISOString()}\n`;
    return { ext: "txt", body: `${head}\n${lines.join("\n")}` };
  }

  const payload = {
    channel: { id: channel.id, name: channel.name },
    exportedAt: new Date().toISOString(),
    part: part ? { index: part.index, total: part.total } : undefined,
    count: messages.length,
    messages
  };

  return { ext: "json", body: JSON.stringify(payload, null, 2) };
}

// Split messages into contiguous groups, each of which renders to a file
// under maxBytes. Uses binary search per chunk to stay efficient on big exports.
function chunkMessages(messages, format, channel, maxBytes) {
  const groups = [];
  let start = 0;

  while (start < messages.length) {
    const remaining = messages.length - start;
    let lo = 1;
    let hi = remaining;
    let best = 1;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const slice = messages.slice(start, start + mid);
      const { body } = buildOutput(slice, format, channel);
      if (Buffer.byteLength(body, "utf8") <= maxBytes) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    // best is at least 1 even if a single message exceeds maxBytes, so we
    // never loop forever; an oversized lone message is emitted as-is.
    groups.push(messages.slice(start, start + best));
    start += best;
  }

  return groups;
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

    const safeName = (channel.name || "channel").replace(/[^a-z0-9_-]/gi, "_");
    const stamp = Date.now();

    const maxFileBytes = maxFileBytesFor(interaction.guild);
    const groups = chunkMessages(collected, format, channel, maxFileBytes);
    const multi = groups.length > 1;

    const files = groups.map((group, i) => {
      const part = multi ? { index: i + 1, total: groups.length } : null;
      const { ext, body } = buildOutput(group, format, channel, part);
      const suffix = multi ? `-part${i + 1}of${groups.length}` : "";
      return new AttachmentBuilder(Buffer.from(body, "utf8"), {
        name: `export-${safeName}${suffix}-${stamp}.${ext}`
      });
    });

    const summary = multi
      ? `✅ Exported **${collected.length}** message(s) from <#${channel.id}> across **${groups.length}** files.`
      : `✅ Exported **${collected.length}** message(s) from <#${channel.id}>.`;

    try {
      await interaction.editReply({
        content: summary,
        files: files.slice(0, FILES_PER_MESSAGE)
      });

      for (let i = FILES_PER_MESSAGE; i < files.length; i += FILES_PER_MESSAGE) {
        await interaction.followUp({
          ephemeral: true,
          files: files.slice(i, i + FILES_PER_MESSAGE)
        });
      }
    } catch (err) {
      console.error("[EXPORT] upload error:", err?.message || err);
      return interaction.editReply(
        "❌ Failed while uploading the export. A single message may exceed the " +
          "file-size limit, or there were too many files. Try a smaller `limit` or a different `format`."
      );
    }
  }
};
