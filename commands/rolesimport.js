const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  PermissionsBitField
} = require("discord.js");
const axios = require("axios");

const CREATE_DELAY_MS = 1000;

// Known permission flag names in the running discord.js version.
const KNOWN_PERMISSIONS = new Set(Object.keys(PermissionsBitField.Flags));

const delay = ms => new Promise(r => setTimeout(r, ms));

function describeError(err) {
  return err?.rawError?.message || err?.message || "unknown error";
}

// Parse a CSV string into an array of string-cell rows.
// Handles quoted fields, escaped "" quotes, and \r\n / \n line endings.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // Swallow CR; the following LF (if any) finalises the row.
    } else {
      field += char;
    }
  }

  // Flush trailing field/row if the file does not end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function isTrue(value) {
  return String(value).trim().toUpperCase() === "TRUE";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rolesimport")
    .setDescription(
      "Recreate roles and permissions in this server from a /rolesexport CSV file"
    )
    .addAttachmentOption(o =>
      o
        .setName("file")
        .setDescription("The CSV file produced by /rolesexport")
        .setRequired(true)
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

    const attachment = interaction.options.getAttachment("file");

    let csvText;

    try {
      const res = await axios.get(attachment.url, { responseType: "text" });
      csvText = typeof res.data === "string" ? res.data : String(res.data);
    } catch (err) {
      console.error("[ROLESIMPORT] file load failed:", err?.message || err);
      return interaction.editReply(
        "Could not download the attached file. Make sure it is the CSV from `/rolesexport`."
      );
    }

    const rows = parseCsv(csvText).filter(r => r.some(c => c.trim() !== ""));

    if (rows.length < 2) {
      return interaction.editReply(
        "That file has no role rows. Make sure it is the CSV from `/rolesexport`."
      );
    }

    const header = rows[0].map(h => h.trim());
    const colIndex = new Map();
    header.forEach((name, i) => {
      if (!colIndex.has(name)) colIndex.set(name, i);
    });

    if (!colIndex.has("Role Name")) {
      return interaction.editReply(
        "That file does not look like a `/rolesexport` export (no `Role Name` column found)."
      );
    }

    // Permission columns = header names that match known permission flags.
    const permissionColumns = header.filter(name => KNOWN_PERMISSIONS.has(name));

    if (permissionColumns.length === 0) {
      return interaction.editReply(
        "That file does not look like a `/rolesexport` export (no permission columns found)."
      );
    }

    const getCell = (rowCells, columnName) => {
      const idx = colIndex.get(columnName);
      return idx === undefined ? "" : (rowCells[idx] ?? "").trim();
    };

    const buildPermissions = rowCells => {
      const bits = new PermissionsBitField();
      for (const permName of permissionColumns) {
        if (isTrue(rowCells[colIndex.get(permName)])) {
          bits.add(PermissionsBitField.Flags[permName]);
        }
      }
      return bits;
    };

    // Build role descriptors from data rows.
    const dataRows = rows.slice(1).map(rowCells => ({
      name: getCell(rowCells, "Role Name"),
      position: Number.parseInt(getCell(rowCells, "Position"), 10) || 0,
      color: getCell(rowCells, "Color"),
      hoist: isTrue(getCell(rowCells, "Hoisted")),
      mentionable: isTrue(getCell(rowCells, "Mentionable")),
      managed: isTrue(getCell(rowCells, "Managed")),
      permissions: buildPermissions(rowCells)
    }));

    let existingNames;

    try {
      const current = await guild.roles.fetch();
      existingNames = new Set(
        [...current.values()].map(r => r.name.toLowerCase())
      );
    } catch (err) {
      console.error("[ROLESIMPORT] role fetch failed:", err?.message || err);
      existingNames = new Set();
    }

    // Create from top to bottom so higher roles are made first (best-effort
    // hierarchy). Discord still places new roles low and the bot can only
    // manage roles below its own highest role.
    const ordered = [...dataRows].sort((a, b) => b.position - a.position);

    await interaction.editReply(
      `Importing **${dataRows.length}** role row(s) into **${guild.name}**. This can take a while...`
    );

    const created = [];
    const skipped = [];
    const failed = [];
    let everyoneUpdated = false;

    for (const role of ordered) {
      if (!role.name) {
        continue;
      }

      // @everyone: apply permissions to this server's existing @everyone role.
      if (role.name === "@everyone") {
        try {
          await guild.roles.everyone.setPermissions(
            role.permissions,
            "rolesimport: apply @everyone permissions"
          );
          everyoneUpdated = true;
        } catch (err) {
          failed.push({ name: "@everyone", reason: describeError(err) });
          console.error(
            "[ROLESIMPORT] @everyone update failed:",
            err?.message || err
          );
        }
        continue;
      }

      // Managed roles (bots/integrations) cannot be recreated.
      if (role.managed) {
        skipped.push(role.name);
        continue;
      }

      // Skip roles whose name already exists here.
      if (existingNames.has(role.name.toLowerCase())) {
        skipped.push(role.name);
        continue;
      }

      try {
        const createOptions = {
          name: role.name,
          hoist: role.hoist,
          mentionable: role.mentionable,
          permissions: role.permissions,
          reason: "rolesimport: recreate role from CSV"
        };

        // "#000000" is Discord's "no color" default; leave it unset.
        if (role.color && role.color !== "#000000") {
          createOptions.color = role.color;
        }

        await guild.roles.create(createOptions);
        created.push(role.name);
        existingNames.add(role.name.toLowerCase());
      } catch (err) {
        failed.push({ name: role.name, reason: describeError(err) });
        console.error(
          `[ROLESIMPORT] failed to create ${role.name}:`,
          err?.message || err
        );
      }

      await delay(CREATE_DELAY_MS);
    }

    const lines = [
      `Import finished for **${guild.name}**:`,
      `- Created: **${created.length}**`,
      `- Skipped (already exist / managed): **${skipped.length}**`,
      `- Failed: **${failed.length}**`
    ];

    if (everyoneUpdated) {
      lines.push("- Applied @everyone permissions from the CSV.");
    }

    if (failed.length > 0) {
      const sample = failed
        .slice(0, 10)
        .map(f => `\`${f.name}\` (${f.reason})`)
        .join(", ");
      lines.push(`\nFailures: ${sample}${failed.length > 10 ? ", ..." : ""}`);
      lines.push(
        "\nNote: the bot can only grant permissions it has and can only create roles below its own highest role. Roles needing higher permissions (e.g. Administrator) will fail."
      );
    }

    await interaction.editReply(lines.join("\n"));
  }
};
