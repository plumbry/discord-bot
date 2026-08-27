const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const {
  MESSAGE_SCAN_LIMIT,
  collectMentionedUsersFromMessages,
  getNonBotMentionedUsers
} = require("../lib/signupTeamScan");

const {
  sendCommandReply,
  syncSignupChannelRoles
} = require("../lib/signupRoleFinish");

const LOG_CHANNEL_ID = "1471082166535454780";

function collectSignupAuthors(messages) {
  const authorsById = new Map();

  for (const message of messages) {
    const author = message.author;

    if (!author || author.bot) {
      continue;
    }

    if (getNonBotMentionedUsers(message).length === 0) {
      continue;
    }

    authorsById.set(author.id, author);
  }

  return [...authorsById.values()];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rolecaptain")
    .setDescription(
      "Give a role only to the person who posted each signup message"
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

    const scannedMessages = [...messages.values()];
    const captains = collectSignupAuthors(scannedMessages);

    if (captains.length === 0) {
      return sendCommandReply(
        interaction,
        "No signup message authors found in recent messages."
      );
    }

    const keepUserIds = new Set(captains.map(user => user.id));
    const mentionedIds = collectMentionedUsersFromMessages(
      scannedMessages
    ).map(user => user.id);
    const removeScopeUserIds = new Set([
      ...mentionedIds,
      ...keepUserIds
    ]);

    const {
      added,
      skipped,
      removed,
      removeSkipped
    } = await syncSignupChannelRoles(
      guild,
      role,
      keepUserIds,
      { removeScopeUserIds }
    );

    const result =
      "Role assignment complete\n" +
      "Role: " + role.name + "\n" +
      "Captains: " + captains.length + "\n" +
      "Added: " + added + "\n" +
      "Skipped: " + skipped + "\n" +
      "Removed: " + removed + "\n" +
      "Remove skipped: " + removeSkipped;

    try {
      const logChannel =
        await guild.channels.fetch(LOG_CHANNEL_ID);

      await logChannel.send(
        "Role Assigned via /rolecaptain\n" +
        "Moderator: " + interaction.user.tag + "\n" +
        "Role: " + role.name + "\n" +
        "Captains: " + captains.length
      );
    } catch {}

    await sendCommandReply(interaction, result);
  }
};
