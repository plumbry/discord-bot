const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { fetchAllMessages } = require("../lib/messages");

function isSignupChannelName(name) {
  const lower = name.toLowerCase();
  return (
    lower.includes("signup") ||
    lower.includes("sign-up") ||
    lower.includes("signups")
  );
}

function findSignupChannelInCategory(guild, categoryId) {
  const matches = guild.channels.cache.filter(channel => {
    if (channel.parentId !== categoryId) {
      return false;
    }

    if (!channel.isTextBased?.()) {
      return false;
    }

    if (!channel.viewable) {
      return false;
    }

    return isSignupChannelName(channel.name);
  });

  const sorted = [...matches.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return sorted[0] ?? null;
}

function getValidTeamMemberIds(message) {
  const memberIds = [
    ...new Set(
      [...message.mentions.users.values()]
        .filter(user => !user.bot)
        .map(user => user.id)
    )
  ];

  if (memberIds.length < 2 || memberIds.length > 4) {
    return null;
  }

  return memberIds;
}

function parseSignupTeams(signupMessages) {
  const teams = [];

  for (const message of signupMessages) {
    if (message.author.bot) {
      continue;
    }

    const memberIds = getValidTeamMemberIds(message);

    if (!memberIds) {
      continue;
    }

    teams.push({
      number: teams.length + 1,
      memberIds
    });
  }

  return teams;
}

function isTeamAcknowledged(memberIds, acknowledgementMessages) {
  const required = new Set(memberIds);

  for (const message of acknowledgementMessages) {
    if (message.author.bot) {
      continue;
    }

    const mentioned = new Set(
      [...message.mentions.users.values()]
        .filter(user => !user.bot)
        .map(user => user.id)
    );

    if ([...required].every(id => mentioned.has(id))) {
      return true;
    }
  }

  return false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("check-rules")
    .setDescription(
      "List scrim teams that have not posted rules acknowledgement in this channel"
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    const baseChannel = interaction.channel.isThread?.()
      ? interaction.channel.parent
      : interaction.channel;

    const category = baseChannel?.parent;

    if (!category) {
      return interaction.reply({
        content: "This command must be used inside an event category."
      });
    }

    const signupChannel = findSignupChannelInCategory(
      interaction.guild,
      category.id
    );

    if (!signupChannel) {
      return interaction.reply({
        content: "No signup channel found in this category."
      });
    }

    await interaction.deferReply();

    const [signupMessages, acknowledgementMessages] = await Promise.all([
      fetchAllMessages(signupChannel),
      fetchAllMessages(interaction.channel)
    ]);

    const teams = parseSignupTeams(signupMessages);

    if (!teams.length) {
      return interaction.editReply({
        content: "No valid signup teams found."
      });
    }

    const missing = teams.filter(
      team => !isTeamAcknowledged(team.memberIds, acknowledgementMessages)
    );

    if (!missing.length) {
      return interaction.editReply({
        content: "All signed-up teams have acknowledged the rules."
      });
    }

    const lines = missing.map(team => `Team ${team.number}`);

    const output =
      `Teams missing rules acknowledgement: ${missing.length}\n\n` +
      lines.join("\n");

    return interaction.editReply({ content: output });
  }
};
