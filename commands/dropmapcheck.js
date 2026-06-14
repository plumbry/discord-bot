const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { fetchAllMessages } = require("../lib/messages");
const {
  buildDropmapCheckReport,
  collectTeamsFromSignupChannel,
  collectTypistIds,
  evaluateDropmapTeams,
  splitDiscordMessages
} = require("../lib/dropmapTeamScan");

function isSignupChannelName(name) {
  return name.toLowerCase().includes("sign");
}

function isDropmapChannelName(name) {
  const normalized = name.toLowerCase();

  return (
    normalized.includes("dropmap") ||
    normalized.includes("drop-map") ||
    normalized.includes("drop_map")
  );
}

function findSignupChannel(guild, categoryId) {
  const signupChannels = guild.channels.cache.filter(channel => {
    if (channel.parentId !== categoryId) {
      return false;
    }

    if (!channel.isTextBased?.()) {
      return false;
    }

    if (!channel.viewable) {
      return false;
    }

    const name = channel.name.toLowerCase();

    if (!isSignupChannelName(name)) {
      return false;
    }

    return !(
      name.includes("solo") ||
      name.includes("lfg") ||
      name.includes("free-agent")
    );
  });

  const channels = [...signupChannels.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return channels[0] || null;
}

function findDropmapChannel(guild, categoryId, preferredChannel) {
  if (preferredChannel && isDropmapChannelName(preferredChannel.name)) {
    return preferredChannel;
  }

  return guild.channels.cache.find(channel => {
    if (channel.parentId !== categoryId) {
      return false;
    }

    if (!channel.isTextBased?.()) {
      return false;
    }

    return channel.viewable && isDropmapChannelName(channel.name);
  }) || null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("dropmapcheck")
    .setDescription(
      "Check which signup teams have at least one member who typed in dropmap"
    )

    .addChannelOption(option =>
      option
        .setName("signup_channel")
        .setDescription(
          "Signup channel to read teams from (defaults to sign channel in this category)"
        )
        .setRequired(false)
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ModerateMembers
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const category = interaction.channel.parent;

    if (!category) {
      return interaction.editReply({
        content: "Run this inside an event category."
      });
    }

    const signupChannel =
      interaction.options.getChannel("signup_channel") ||
      findSignupChannel(interaction.guild, category.id);

    if (!signupChannel) {
      return interaction.editReply({
        content:
          "Could not find a team signup channel in this category. " +
          "Pick one with **sign** in the name, or pass **signup_channel**."
      });
    }

    const dropmapChannel = findDropmapChannel(
      interaction.guild,
      category.id,
      interaction.channel
    );

    if (!dropmapChannel) {
      return interaction.editReply({
        content:
          "Could not find a dropmap channel in this category. " +
          "Run this from dropmap or add a channel with **dropmap** in the name."
      });
    }

    const teams = await collectTeamsFromSignupChannel(signupChannel);

    if (teams.length === 0) {
      return interaction.editReply({
        content:
          `No signup teams found in ${signupChannel}. ` +
          "Expected @mention signups, numbered team reactions, or a multi-line mention list."
      });
    }

    const dropmapMessages = await fetchAllMessages(dropmapChannel);
    const typistIds = collectTypistIds(dropmapMessages);
    const { marked, missing } = evaluateDropmapTeams(teams, typistIds);

    const report = buildDropmapCheckReport({
      teams,
      marked,
      missing,
      signupChannel,
      dropmapChannel
    });

    const chunks = splitDiscordMessages(report);

    await interaction.editReply({ content: chunks[0] });

    for (let index = 1; index < chunks.length; index++) {
      await interaction.followUp({
        content: chunks[index],
        ephemeral: true
      });
    }
  }
};
