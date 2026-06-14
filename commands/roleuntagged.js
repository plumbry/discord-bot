const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { MESSAGE_SCAN_LIMIT } = require("../lib/signupTeamScan");

const {
  collectUsersFromUntaggedMessages,
  createNameResolveSession
} = require("../lib/untaggedSignupScan");

const {
  sendCommandReply,
  syncSignupChannelRoles
} = require("../lib/signupRoleFinish");

const LOG_CHANNEL_ID = "1471082166535454780";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roleuntagged")
    .setDescription(
      "Give a role to every plain username listed in this channel (no @mentions)"
    )

    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Role to give")
        .setRequired(true)
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageRoles
    ),

  async execute(interaction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    const role = interaction.options.getRole("role");
    const channel = interaction.channel;
    const guild = interaction.guild;
    const sessionCache = createNameResolveSession();

    const messages = await channel.messages.fetch({
      limit: MESSAGE_SCAN_LIMIT
    });

    const orderedMessages = [...messages.values()].reverse();

    const { resolvedUsers, unresolved } =
      await collectUsersFromUntaggedMessages(
        orderedMessages,
        guild,
        sessionCache
      );

    if (resolvedUsers.length === 0) {
      const unresolvedNote =
        unresolved.length > 0
          ? `\nCould not resolve: ${unresolved.map(entry => entry.slot).join(", ")}`
          : "";

      return sendCommandReply(
        interaction,
        "No usernames found to role." + unresolvedNote
      );
    }

    const keepUserIds = new Set(
      resolvedUsers.map(user => user.id)
    );

    const {
      added,
      skipped,
      removed,
      removeSkipped
    } = await syncSignupChannelRoles(
      guild,
      role,
      keepUserIds
    );

    const unresolvedNote =
      unresolved.length > 0
        ? `\nUnresolved (${unresolved.length}): ${unresolved.map(entry => entry.slot).slice(0, 20).join(", ")}${unresolved.length > 20 ? "…" : ""}`
        : "";

    const result =
      "Role assignment complete\n" +
      "Role: " + role.name + "\n" +
      "Usernames matched: " + resolvedUsers.length + "\n" +
      "Added: " + added + "\n" +
      "Skipped: " + skipped + "\n" +
      "Removed: " + removed + "\n" +
      "Remove skipped: " + removeSkipped +
      unresolvedNote;

    try {
      const logChannel =
        await guild.channels.fetch(LOG_CHANNEL_ID);

      await logChannel.send(
        "Role Assigned via /roleuntagged\n" +
        "Moderator: " + interaction.user.tag + "\n" +
        "Role: " + role.name + "\n" +
        "Users: " + resolvedUsers.length
      );
    } catch {}

    await sendCommandReply(interaction, result);
  }
};
