const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");
const axios = require("axios");

const ASSIGN_DELAY_MS = 1000;

const delay = ms => new Promise(r => setTimeout(r, ms));

function describeError(err) {
  return err?.rawError?.message || err?.message || "unknown error";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("memberrolesimport")
    .setDescription(
      "Reassign each member's roles in this server from a /memberrolesexport JSON file"
    )
    .addAttachmentOption(o =>
      o
        .setName("file")
        .setDescription("The JSON file produced by /memberrolesexport")
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

    let manifest;

    try {
      const res = await axios.get(attachment.url, { responseType: "text" });
      manifest =
        typeof res.data === "string" ? JSON.parse(res.data) : res.data;
    } catch (err) {
      console.error(
        "[MEMBERROLESIMPORT] manifest load failed:",
        err?.message || err
      );
      return interaction.editReply(
        "Could not read or parse the attached file. Make sure it is a JSON file from `/memberrolesexport`."
      );
    }

    if (!manifest || !Array.isArray(manifest.members)) {
      return interaction.editReply(
        "That file does not look like a `/memberrolesexport` export (no `members` list found)."
      );
    }

    const entries = manifest.members.filter(
      m => m && m.id && Array.isArray(m.roles) && m.roles.length > 0
    );

    if (entries.length === 0) {
      return interaction.editReply(
        "The file contains no member role assignments to import."
      );
    }

    try {
      await guild.members.fetch();
    } catch (err) {
      console.error(
        "[MEMBERROLESIMPORT] member fetch failed:",
        err?.message || err
      );
    }

    // Lookup of existing assignable roles by lowercased name. @everyone and
    // managed (bot/integration) roles cannot be assigned, so they're excluded.
    const rolesByName = new Map();

    try {
      const roleCollection = await guild.roles.fetch();
      for (const role of roleCollection.values()) {
        if (role.id === guild.id || role.managed) {
          continue;
        }
        const key = role.name.toLowerCase();
        if (!rolesByName.has(key)) {
          rolesByName.set(key, role);
        }
      }
    } catch (err) {
      console.error(
        "[MEMBERROLESIMPORT] role fetch failed:",
        err?.message || err
      );
      return interaction.editReply(
        "Could not load this server's roles. Try again later."
      );
    }

    await interaction.editReply(
      `Importing role assignments for **${entries.length}** member(s) into **${guild.name}**. This can take a while...`
    );

    let updated = 0;
    let notInServer = 0;
    let rolesAssigned = 0;
    const missingRoles = new Set();
    const failed = [];

    for (const entry of entries) {
      const member = guild.members.cache.get(entry.id);

      if (!member) {
        notInServer++;
        continue;
      }

      const matchedIds = [];

      for (const roleName of entry.roles) {
        const role = rolesByName.get(String(roleName).toLowerCase());
        if (role) {
          matchedIds.push(role.id);
        } else {
          missingRoles.add(roleName);
        }
      }

      if (matchedIds.length === 0) {
        continue;
      }

      try {
        await member.roles.add(
          matchedIds,
          "memberrolesimport: reassign roles from export"
        );
        updated++;
        rolesAssigned += matchedIds.length;
      } catch (err) {
        failed.push({ tag: entry.tag || entry.id, reason: describeError(err) });
        console.error(
          `[MEMBERROLESIMPORT] failed to assign roles to ${entry.tag || entry.id}:`,
          err?.message || err
        );
      }

      await delay(ASSIGN_DELAY_MS);
    }

    const lines = [
      `Import finished for **${guild.name}**:`,
      `- Members updated: **${updated}**`,
      `- Roles assigned: **${rolesAssigned}**`,
      `- Members not in this server (skipped): **${notInServer}**`,
      `- Missing roles (not found here): **${missingRoles.size}**`,
      `- Failed: **${failed.length}**`
    ];

    if (missingRoles.size > 0) {
      const sample = [...missingRoles]
        .slice(0, 10)
        .map(name => `\`${name}\``)
        .join(", ");
      lines.push(
        `\nMissing roles: ${sample}${missingRoles.size > 10 ? ", ..." : ""}`
      );
      lines.push(
        "Recreate these roles here (e.g. with `/rolesimport`) and re-run to assign them."
      );
    }

    if (failed.length > 0) {
      const sample = failed
        .slice(0, 10)
        .map(f => `\`${f.tag}\` (${f.reason})`)
        .join(", ");
      lines.push(`\nFailures: ${sample}${failed.length > 10 ? ", ..." : ""}`);
      lines.push(
        "\nNote: the bot can only assign roles below its own highest role."
      );
    }

    await interaction.editReply(lines.join("\n"));
  }
};
