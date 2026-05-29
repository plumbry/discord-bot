const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  AttachmentBuilder
} = require("discord.js");

const MAX_FILE_BYTES = 8 * 1024 * 1024;

// Role names that should never be exported/reassigned: @everyone is implicit
// and managed roles belong to bots/integrations and cannot be granted.
function assignableRoleNames(member) {
  return [...member.roles.cache.values()]
    .filter(role => role.id !== member.guild.id && !role.managed)
    .map(role => role.name);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("memberrolesexport")
    .setDescription(
      "Export every member's role assignments to a JSON file for importing into another server"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

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

    try {
      await guild.members.fetch();
    } catch (err) {
      console.error(
        "[MEMBERROLESEXPORT] member fetch failed:",
        err?.message || err
      );
      return interaction.editReply(
        "Could not load server members. Try again later."
      );
    }

    const members = [];

    for (const member of guild.members.cache.values()) {
      const roles = assignableRoleNames(member);

      if (roles.length === 0) {
        continue;
      }

      members.push({
        id: member.id,
        tag: member.user.tag,
        roles
      });
    }

    if (members.length === 0) {
      return interaction.editReply(
        "No members with assignable roles were found to export."
      );
    }

    const payload = {
      guild: { id: guild.id, name: guild.name },
      exportedAt: new Date().toISOString(),
      count: members.length,
      members
    };

    const body = JSON.stringify(payload, null, 2);
    const buffer = Buffer.from(body, "utf8");

    if (buffer.byteLength > MAX_FILE_BYTES) {
      return interaction.editReply(
        `Export is too large to upload (${(
          buffer.byteLength /
          1024 /
          1024
        ).toFixed(1)} MB).`
      );
    }

    const safeGuildName =
      guild.name.replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "") ||
      "guild";

    const fileName = `member-roles-${safeGuildName}-${
      new Date().toISOString().slice(0, 10)
    }.json`;

    const file = new AttachmentBuilder(buffer, { name: fileName });

    const totalAssignments = members.reduce((sum, m) => sum + m.roles.length, 0);

    await interaction.editReply({
      content:
        `Exported role assignments for **${members.length}** member(s) ` +
        `(**${totalAssignments}** total role assignment(s)).\n` +
        "Run `/memberrolesimport` in the target server and attach this file.",
      files: [file]
    });
  }
};
