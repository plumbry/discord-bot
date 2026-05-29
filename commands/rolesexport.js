const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  AttachmentBuilder
} = require("discord.js");

const PERMISSION_NAMES = Object.keys(PermissionsBitField.Flags).sort();

function serializeRole(role) {
  // List only the permission flags this role actually grants; anything not
  // present is implicitly false. The raw bitfield is kept for exact re-import.
  const grantedPermissions = PERMISSION_NAMES.filter(name =>
    role.permissions.has(PermissionsBitField.Flags[name])
  );

  return {
    name: role.name,
    id: role.id,
    position: role.position,
    color: role.hexColor,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
    memberCount: role.members.size,
    permissionsBitfield: role.permissions.bitfield.toString(),
    permissions: grantedPermissions
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rolesexport")
    .setDescription("Export a JSON file of all roles and their permissions")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
    }

    const guild = interaction.guild;

    if (!guild) {
      return interaction.editReply(
        "This command can only be used in a server."
      );
    }

    // Populate the member cache so per-role member counts are accurate.
    try {
      await guild.members.fetch();
    } catch (err) {
      console.error("[ROLESEXPORT] member fetch failed:", err?.message || err);
    }

    let roleCollection;

    try {
      roleCollection = await guild.roles.fetch();
    } catch (err) {
      console.error("[ROLESEXPORT] role fetch failed:", err?.message || err);
      return interaction.editReply(
        "Could not load server roles. Try again later."
      );
    }

    const roles = [...roleCollection.values()]
      .sort((a, b) => b.position - a.position)
      .map(serializeRole);

    const payload = {
      guild: { id: guild.id, name: guild.name },
      exportedAt: new Date().toISOString(),
      version: 1,
      count: roles.length,
      roles
    };

    const body = JSON.stringify(payload, null, 2);

    const safeGuildName = guild.name
      .replace(/[^a-z0-9-_]+/gi, "_")
      .replace(/^_+|_+$/g, "") || "guild";

    const fileName = `roles-permissions-${safeGuildName}-${
      new Date().toISOString().slice(0, 10)
    }.json`;

    const attachment = new AttachmentBuilder(Buffer.from(body, "utf8"), {
      name: fileName
    });

    await interaction.editReply({
      content: `Exported **${roles.length}** role(s) to JSON.`,
      files: [attachment]
    });
  }
};
