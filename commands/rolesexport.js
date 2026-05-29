const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField,
  AttachmentBuilder
} = require("discord.js");

// All permission flag names, used as one CSV column each (TRUE/FALSE per role).
const PERMISSION_NAMES = Object.keys(PermissionsBitField.Flags).sort();

const METADATA_HEADERS = [
  "Role Name",
  "Role ID",
  "Position",
  "Color",
  "Hoisted",
  "Mentionable",
  "Managed",
  "Member Count"
];

function csvEscape(value) {
  const str = value === null || value === undefined ? "" : String(value);

  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

function buildCsv(roles) {
  const header = [...METADATA_HEADERS, ...PERMISSION_NAMES]
    .map(csvEscape)
    .join(",");

  const lines = [header];

  for (const role of roles) {
    const row = [
      role.name,
      role.id,
      role.position,
      role.hexColor,
      role.hoist ? "TRUE" : "FALSE",
      role.mentionable ? "TRUE" : "FALSE",
      role.managed ? "TRUE" : "FALSE",
      role.members.size
    ];

    for (const permName of PERMISSION_NAMES) {
      row.push(
        role.permissions.has(PermissionsBitField.Flags[permName])
          ? "TRUE"
          : "FALSE"
      );
    }

    lines.push(row.map(csvEscape).join(","));
  }

  return lines.join("\r\n");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rolesexport")
    .setDescription("Export a CSV of all roles and their permissions")
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

    const roles = [...roleCollection.values()].sort(
      (a, b) => b.position - a.position
    );

    const csv = buildCsv(roles);

    const safeGuildName = guild.name
      .replace(/[^a-z0-9-_]+/gi, "_")
      .replace(/^_+|_+$/g, "") || "guild";

    const fileName = `roles-permissions-${safeGuildName}-${
      new Date().toISOString().slice(0, 10)
    }.csv`;

    const attachment = new AttachmentBuilder(Buffer.from(csv, "utf8"), {
      name: fileName
    });

    await interaction.editReply({
      content:
        `Exported **${roles.length}** role(s) with ` +
        `**${PERMISSION_NAMES.length}** permission columns.`,
      files: [attachment]
    });
  }
};
