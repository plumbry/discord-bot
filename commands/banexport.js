const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder
} = require("discord.js");

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const PAGE_SIZE = 1000;

function serializeBan(ban) {
  const user = ban.user;

  return {
    id: user?.id || null,
    username: user?.username || null,
    globalName: user?.globalName || null,
    tag: user?.tag || null,
    bot: Boolean(user?.bot),
    reason: ban.reason || null
  };
}

// Discord returns at most PAGE_SIZE bans per request, so page through the
// full list using the last user id as the `after` cursor.
async function fetchAllBans(guild) {
  const all = [];
  let after;

  while (true) {
    const page = await guild.bans.fetch({ limit: PAGE_SIZE, after });

    if (page.size === 0) {
      break;
    }

    for (const ban of page.values()) {
      all.push(ban);
    }

    if (page.size < PAGE_SIZE) {
      break;
    }

    after = page.lastKey();
  }

  return all;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("banexport")
    .setDescription(
      "Export the server's ban list (banned members and reasons) to a JSON file"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

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

    let bans;

    try {
      bans = await fetchAllBans(guild);
    } catch (err) {
      console.error("[BANEXPORT] fetch failed:", err?.message || err);
      return interaction.editReply(
        "Could not load the server ban list. Make sure I have the **Ban Members** permission, then try again."
      );
    }

    if (bans.length === 0) {
      return interaction.editReply("This server has no banned members to export.");
    }

    const serialized = bans.map(serializeBan);

    const payload = {
      guild: { id: guild.id, name: guild.name },
      exportedAt: new Date().toISOString(),
      version: 1,
      count: serialized.length,
      bans: serialized
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

    const fileName = `bans-${safeGuildName}-${
      new Date().toISOString().slice(0, 10)
    }.json`;

    const file = new AttachmentBuilder(buffer, { name: fileName });

    await interaction.editReply({
      content: `Exported **${serialized.length}** banned member(s) to JSON.`,
      files: [file]
    });
  }
};
