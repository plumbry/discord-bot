const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const axios = require("axios");
const { getApiBaseUrl } = require("../lib/discordApi");

const ACCEPTED_REACTION_ID = "1405510864496361482";
const ACCEPTED_REACTION_NAME = "ZBDACCEPTED";
const FILL_REACTION_NAME = "\u270b";

function getApiHeaders() {
  const apiKey = process.env.SCRIM_EVENTS_API_KEY || process.env.DISCORD_SYNC_API_KEY;

  return {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  };
}

function getEventTypeLabel(eventType) {
  switch (eventType) {
    case "duos_into_squads":
      return "Duos into squads";
    case "duos_plus_solos_into_trios":
      return "Duos + solos into trios";
    case "solos_into_duos":
      return "Solos into duos";
    default:
      return eventType || "Unknown";
  }
}

function normalizePlayerName(value) {
  return value
    .replace(/<@!?(\d+)>/g, "<@$1>")
    .replace(/^[-*•\d.)\s]+/, "")
    .trim();
}

function parseDuoEntry(rawValue, fallbackName) {
  const value = rawValue
    .replace(/\*\*/g, "")
    .replace(/\r/g, "")
    .trim();

  if (!value) return null;

  const match = value.match(/^(.+?)\s*(?:-|:|=)\s*(.+)$/);
  const teamName = match ? match[1].trim() : fallbackName;
  const playerText = match ? match[2].trim() : value;

  const players = playerText
    .split(/[,/|+&\n]/)
    .map(normalizePlayerName)
    .filter(Boolean);

  if (players.length !== 2) return null;

  return {
    teamName: teamName || players.join(" / "),
    players
  };
}

function parseSoloEntry(rawValue) {
  const playerName = normalizePlayerName(
    rawValue
      .replace(/\*\*/g, "")
      .replace(/\r/g, "")
      .trim()
  );

  if (!playerName) return null;

  return { playerName };
}

function readMessageText(message) {
  const parts = [];

  if (message.content) {
    parts.push(message.content);
  }

  for (const embed of message.embeds.values()) {
    if (embed.title) parts.push(embed.title);
    if (embed.description) parts.push(embed.description);

    for (const field of embed.fields || []) {
      if (field.name) parts.push(field.name);
      if (field.value) parts.push(field.value);
    }
  }

  return parts.join("\n").trim();
}

function getSignupStatus(message) {
  let hasAcceptedReaction = false;
  let hasFillReaction = false;

  for (const reaction of message.reactions.cache.values()) {
    if (!reaction.count) continue;

    const emojiId = reaction.emoji?.id;
    const emojiName = reaction.emoji?.name;

    if (emojiId === ACCEPTED_REACTION_ID || emojiName === ACCEPTED_REACTION_NAME) {
      hasAcceptedReaction = true;
    }

    if (emojiName === FILL_REACTION_NAME) {
      hasFillReaction = true;
    }
  }

  if (hasAcceptedReaction) {
    return "accepted";
  }

  if (hasFillReaction) {
    return "fill";
  }

  return "invalid";
}

function isReadableSignupChannel(channel) {
  return (
    channel?.type === ChannelType.GuildText ||
    channel?.type === ChannelType.PublicThread ||
    channel?.type === ChannelType.PrivateThread ||
    channel?.type === ChannelType.AnnouncementThread ||
    channel?.type === ChannelType.GuildAnnouncement
  );
}

function normalizeChannelName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferEntryTypeFromChannelName(channelName) {
  const name = normalizeChannelName(channelName);

  if (/\b(solo|solos|single|singles)\b/.test(name)) {
    return "solo";
  }

  if (/\b(duo|duos|team|teams)\b/.test(name)) {
    return "duo";
  }

  return null;
}

function shouldIgnoreChannel(channelName) {
  const name = normalizeChannelName(channelName);

  return /\b(admin|staff|host|hosts|result|results|chat|rules|info|announce|announcements|wheel|spin)\b/.test(name);
}

function discoverCategorySignupChannels(interaction, eventType) {
  const categoryId = interaction.channel?.parentId;

  if (!categoryId) {
    throw new Error("Run this command inside the event category so I can find the signup channels.");
  }

  const categoryChannels = interaction.guild.channels.cache
    .filter(channel => channel.parentId === categoryId && isReadableSignupChannel(channel))
    .sort((a, b) => (a.rawPosition || 0) - (b.rawPosition || 0));

  const discovered = [];

  for (const channel of categoryChannels.values()) {
    if (shouldIgnoreChannel(channel.name)) continue;

    const entryType = inferEntryTypeFromChannelName(channel.name);

    if (!entryType) continue;

    discovered.push({
      discordChannelId: channel.id,
      entryType,
      source: "category"
    });
  }

  if (eventType === "duos_into_squads") {
    return discovered.filter(channel => channel.entryType === "duo");
  }

  if (eventType === "duos_plus_solos_into_trios") {
    return discovered.filter(channel => channel.entryType === "duo" || channel.entryType === "solo");
  }

  if (eventType === "solos_into_duos") {
    return discovered.filter(channel => channel.entryType === "solo");
  }

  return discovered;
}

function validateSignupChannels(eventType, signupChannels) {
  const duoCount = signupChannels.filter(channel => channel.entryType === "duo").length;
  const soloCount = signupChannels.filter(channel => channel.entryType === "solo").length;

  if (eventType === "duos_into_squads" && duoCount < 1) {
    return "I could not find a duo signup channel in this category. Name it something like `duo-signups` or `teams`.";
  }

  if (eventType === "duos_plus_solos_into_trios" && (duoCount < 1 || soloCount < 1)) {
    return "I need one duo signup channel and one solo signup channel in this category. Name them something like `duo-signups` and `solo-signups`.";
  }

  if (eventType === "solos_into_duos" && soloCount < 1) {
    return "I could not find a solo signup channel in this category. Name it something like `solo-signups`.";
  }

  return null;
}

async function fetchSignupMessages(interaction, discordChannelId) {
  const channel = await interaction.guild.channels.fetch(discordChannelId);

  if (!channel) {
    throw new Error(`Could not find signup channel ${discordChannelId}.`);
  }

  if (!isReadableSignupChannel(channel)) {
    throw new Error(`<#${discordChannelId}> is not a readable message channel.`);
  }

  const messages = await channel.messages.fetch({ limit: 100 });

  return [...messages.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(message => ({
      channelId: discordChannelId,
      messageId: message.id,
      authorId: message.author?.id,
      status: getSignupStatus(message),
      text: readMessageText(message)
    }))
    .filter(message => message.text);
}

function collectEntries(messages, entryType) {
  const teams = [];
  const soloPlayers = [];
  const stats = {
    accepted: 0,
    fills: 0,
    invalid: 0,
    unparsable: 0
  };

  for (const message of messages) {
    if (message.status === "invalid") {
      stats.invalid++;
      continue;
    }

    const lines = message.text
      .split(/\n/)
      .map(line => line.trim())
      .filter(Boolean);

    if (entryType === "duo") {
      for (const line of lines) {
        const team = parseDuoEntry(line, `Duo ${teams.length + 1}`);

        if (team) {
          if (message.status === "fill") stats.fills++;
          if (message.status === "accepted") stats.accepted++;

          teams.push({
            ...team,
            signupStatus: message.status,
            isFill: message.status === "fill",
            sourceChannelId: message.channelId,
            sourceMessageId: message.messageId
          });
        } else {
          stats.unparsable++;
        }
      }
    }

    if (entryType === "solo") {
      for (const line of lines) {
        const solo = parseSoloEntry(line);

        if (solo) {
          if (message.status === "fill") stats.fills++;
          if (message.status === "accepted") stats.accepted++;

          soloPlayers.push({
            ...solo,
            signupStatus: message.status,
            isFill: message.status === "fill",
            sourceChannelId: message.channelId,
            sourceMessageId: message.messageId
          });
        } else {
          stats.unparsable++;
        }
      }
    }
  }

  return { teams, soloPlayers, stats };
}

function dedupeTeams(teams) {
  const seen = new Set();

  return teams.filter(team => {
    const key = team.players
      .map(player => player.toLowerCase())
      .sort()
      .join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeSoloPlayers(soloPlayers) {
  const seen = new Set();

  return soloPlayers.filter(player => {
    const key = player.playerName.toLowerCase();

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitFillEntries(teams, soloPlayers) {
  return {
    acceptedTeams: teams.filter(team => !team.isFill),
    fillTeams: teams.filter(team => team.isFill),
    acceptedSoloPlayers: soloPlayers.filter(player => !player.isFill),
    fillSoloPlayers: soloPlayers.filter(player => player.isFill)
  };
}

function validateEntries(eventType, teams, soloPlayers) {
  if (eventType === "duos_into_squads" && teams.length < 2) {
    return "I found fewer than 2 duos in the configured signup channel.";
  }

  if (eventType === "duos_plus_solos_into_trios") {
    if (teams.length < 1 || soloPlayers.length < 1) {
      return "I need at least 1 duo and 1 solo for duos + solos into trios.";
    }
  }

  if (eventType === "solos_into_duos" && soloPlayers.length < 2) {
    return "I found fewer than 2 solos in the configured signup channel(s).";
  }

  return null;
}

function buildResultMessage(
  event,
  teams,
  soloPlayers,
  fillTeams,
  fillSoloPlayers,
  importStats,
  adminUrl
) {
  const warnings = [];

  if (
    event.eventType === "duos_plus_solos_into_trios" &&
    soloPlayers.length < teams.length
  ) {
    warnings.push(
      `Warning: found ${teams.length} duo(s) but only ${soloPlayers.length} solo(s). Some duos may not get a solo.`
    );
  }

  const warningText = warnings.length ? `\n\n${warnings.join("\n")}` : "";
  const fillCount = fillTeams.length + fillSoloPlayers.length;
  const statsText =
    `\nAccepted entries: **${importStats.accepted}**` +
    `\nFill entries: **${fillCount}**` +
    `\nInvalid skipped: **${importStats.invalid}**` +
    (importStats.unparsable ? `\nUnparsable skipped: **${importStats.unparsable}**` : "");

  return (
    `Linked spin event: **${event.eventName || event.name || event.eventCode}**\n` +
    `Type: **${getEventTypeLabel(event.eventType)}**\n` +
    `Duos imported: **${teams.length}**\n` +
    `Solos imported: **${soloPlayers.length}**\n` +
    `Fill duos: **${fillTeams.length}**\n` +
    `Fill solos: **${fillSoloPlayers.length}**` +
    statsText +
    (adminUrl ? `\n\nWheel page: ${adminUrl}` : "") +
    warningText
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("spin")
    .setDescription("Import scrim signups into a website spin event")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption(option =>
      option
        .setName("code")
        .setDescription("Event code from the website")
        .setRequired(true)
        .setMaxLength(40)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const eventCode = interaction.options.getString("code").trim();
    const apiBaseUrl = getApiBaseUrl();

    try {
      const eventResponse = await axios.get(
        `${apiBaseUrl}/api/scrim-events/by-code/${encodeURIComponent(eventCode)}`,
        {
          headers: getApiHeaders(),
          timeout: 15000
        }
      );

      const event = eventResponse.data;
      const configuredSignupChannels = event.signupChannels || event.channels || [];
      let signupChannels = [];

      if (!event.eventId && !event.id) {
        return await interaction.editReply({
          content: "The website returned an event, but it did not include an event ID."
        });
      }

      try {
        signupChannels = discoverCategorySignupChannels(interaction, event.eventType);
      } catch (error) {
        if (!configuredSignupChannels.length) {
          throw error;
        }
      }

      if (!signupChannels.length) {
        signupChannels = configuredSignupChannels;
      }

      if (!signupChannels.length) {
        return await interaction.editReply({
          content:
            "That event code exists, but I could not find signup channels in this category. " +
            "Use channel names with `duo`, `team`, or `solo` in them."
        });
      }

      const signupChannelError = validateSignupChannels(event.eventType, signupChannels);

      if (signupChannelError) {
        return await interaction.editReply({
          content: signupChannelError
        });
      }

      const allTeams = [];
      const allSoloPlayers = [];
      const importStats = {
        accepted: 0,
        fills: 0,
        invalid: 0,
        unparsable: 0
      };
      const sourceChannelIds = [];

      for (const signupChannel of signupChannels) {
        const discordChannelId =
          signupChannel.discordChannelId || signupChannel.channelId;
        const entryType = signupChannel.entryType || signupChannel.type;

        if (!discordChannelId || !entryType) {
          throw new Error("A signup channel is missing discordChannelId or entryType.");
        }

        const messages = await fetchSignupMessages(interaction, discordChannelId);
        const { teams, soloPlayers, stats } = collectEntries(messages, entryType);

        sourceChannelIds.push(discordChannelId);
        allTeams.push(...teams);
        allSoloPlayers.push(...soloPlayers);
        importStats.accepted += stats.accepted;
        importStats.fills += stats.fills;
        importStats.invalid += stats.invalid;
        importStats.unparsable += stats.unparsable;
      }

      const dedupedTeams = dedupeTeams(allTeams);
      const dedupedSoloPlayers = dedupeSoloPlayers(allSoloPlayers);
      const {
        acceptedTeams,
        fillTeams,
        acceptedSoloPlayers,
        fillSoloPlayers
      } = splitFillEntries(dedupedTeams, dedupedSoloPlayers);
      const validationError = validateEntries(event.eventType, acceptedTeams, acceptedSoloPlayers);

      if (validationError) {
        return await interaction.editReply({
          content: validationError
        });
      }

      const eventId = event.eventId || event.id;
      const saveResponse = await axios.post(
        `${apiBaseUrl}/api/scrim-events/${encodeURIComponent(eventId)}/entries`,
        {
          eventCode,
          discordGuildId: interaction.guildId,
          importedByDiscordId: interaction.user.id,
          sourceChannelIds,
          teams: acceptedTeams,
          soloPlayers: acceptedSoloPlayers,
          fillTeams,
          fillSoloPlayers,
          importStats
        },
        {
          headers: getApiHeaders(),
          timeout: 15000
        }
      );

      await interaction.editReply({
        content: buildResultMessage(
          event,
          acceptedTeams,
          acceptedSoloPlayers,
          fillTeams,
          fillSoloPlayers,
          importStats,
          saveResponse.data?.adminUrl || event.adminUrl
        )
      });
    } catch (error) {
      console.error("Failed importing spin event:", error.response?.data || error.message);

      await interaction.editReply({
        content:
          "I could not import signups for that event code. Check the event code, configured signup channels, bot channel access, and coedzbd.com API logs."
      });
    }
  }
};
