const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const {
  MESSAGE_SCAN_LIMIT,
  collectMentionedUsersFromMessages
} = require("../lib/signupTeamScan");

const {
  sendCommandReply,
  syncSignupChannelRoles
} = require("../lib/signupRoleFinish");

const LOG_CHANNEL_ID = "1471082166535454780";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roleuntagged")
    .setDescription(
      "Give a role to every @mentioned user in this channel (no team checks)"
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
    const guild = interaction.guild;

    const messages = await interaction.channel.messages.fetch({
      limit: MESSAGE_SCAN_LIMIT
    });

    const mentionedUsers = collectMentionedUsersFromMessages(
      [...messages.values()]
    );

    if (mentionedUsers.length === 0) {
      return sendCommandReply(
        interaction,
        "No @mentioned users found in recent messages."
      );
    }

    const keepUserIds = new Set(
      mentionedUsers.map(user => user.id)
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

    const result =
      "Role assignment complete\n" +
      "Role: " + role.name + "\n" +
      "Users tagged: " + mentionedUsers.length + "\n" +
      "Added: " + added + "\n" +
      "Skipped: " + skipped + "\n" +
      "Removed: " + removed + "\n" +
      "Remove skipped: " + removeSkipped;

    try {
      const logChannel =
        await guild.channels.fetch(LOG_CHANNEL_ID);

      await logChannel.send(
        "Role Assigned via /roleuntagged\n" +
        "Moderator: " + interaction.user.tag + "\n" +
        "Role: " + role.name + "\n" +
        "Users: " + mentionedUsers.length
      );
    } catch {}

    await sendCommandReply(interaction, result);
  }
};
