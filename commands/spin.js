const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const axios = require("axios");

const DEFAULT_SCRIM_EVENTS_API_URL =
  "https://healthy-husky-184.convex.site/api/scrim-events";

function parseTeams(rawTeams) {
  if (!rawTeams) return [];

  const lines = rawTeams
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const match = line.match(/^(.+?)\s*(?:-|:|=|,)\s*(.+)$/);

    if (!match) {
      throw new Error(
        `Line ${index + 1} is invalid. Use "Team Name - Player 1, Player 2".`
      );
    }

    const teamName = match[1].trim();
    const players = match[2]
      .split(/[,/|+&]/)
      .map(player => player.trim())
      .filter(Boolean);

    if (!teamName) {
      throw new Error(`Line ${index + 1} is missing a team name.`);
    }

    if (players.length !== 2) {
      throw new Error(
        `Line ${index + 1} must have exactly 2 players. Example: ${teamName} - Player 1, Player 2`
      );
    }

    return {
      teamName,
      players
    };
  });
}

function parseSoloPlayers(rawPlayers) {
  if (!rawPlayers) return [];

  return rawPlayers
    .split(/\r?\n|,/)
    .map(player => player.trim())
    .filter(Boolean)
    .map(playerName => ({ playerName }));
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
      return eventType;
  }
}

function buildDiscordPreview(eventName, eventType, teams, soloPlayers, adminUrl) {
  const teamLines = teams
    .slice(0, 12)
    .map(team => `- ${team.teamName}: ${team.players.join(" / ")}`)
    .join("\n");

  const extraCount = teams.length > 12 ? `\n...and ${teams.length - 12} more team(s).` : "";
  const soloLines = soloPlayers
    .slice(0, 20)
    .map(player => `- ${player.playerName}`)
    .join("\n");
  const extraSoloCount =
    soloPlayers.length > 20 ? `\n...and ${soloPlayers.length - 20} more solo player(s).` : "";
  const linkLine = adminUrl ? `\n\nWheel page: ${adminUrl}` : "";

  const sections = [
    `Created scrim event: **${eventName}**`,
    `Type: **${getEventTypeLabel(eventType)}**`,
    `Duos logged: **${teams.length}**`,
    `Solos logged: **${soloPlayers.length}**`
  ];

  if (teamLines) {
    sections.push(`\nDuos:\n${teamLines}${extraCount}`);
  }

  if (soloLines) {
    sections.push(`\nSolos:\n${soloLines}${extraSoloCount}`);
  }

  return `${sections.join("\n")}${linkLine}`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("spin")
    .setDescription("Create a random scrim pairing event")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand
        .setName("create")
        .setDescription("Create a duo-into-squads pairing event")
        .addStringOption(option =>
          option
            .setName("event_name")
            .setDescription("Name of the scrim event")
            .setRequired(true)
            .setMaxLength(100))
        .addStringOption(option =>
          option
            .setName("event_type")
            .setDescription("Type of random pairing event")
            .setRequired(true)
            .addChoices(
              { name: "Duos into squads", value: "duos_into_squads" },
              { name: "Duos + solos into trios", value: "duos_plus_solos_into_trios" },
              { name: "Solos into duos", value: "solos_into_duos" }
            ))
        .addIntegerOption(option =>
          option
            .setName("games")
            .setDescription("Number of games to generate pairings for")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(10))
        .addStringOption(option =>
          option
            .setName("duos")
            .setDescription("One duo per line: Team Name - Player 1, Player 2")
            .setRequired(false)
            .setMaxLength(4000))
        .addStringOption(option =>
          option
            .setName("solos")
            .setDescription("Solo names, one per line or comma-separated")
            .setRequired(false)
            .setMaxLength(4000))),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const subcommand = interaction.options.getSubcommand();

    if (subcommand !== "create") {
      return await interaction.editReply({
        content: "Unknown scrim event action."
      });
    }

    const eventName = interaction.options.getString("event_name");
    const eventType = interaction.options.getString("event_type");
    const games = interaction.options.getInteger("games");
    const rawDuos = interaction.options.getString("duos");
    const rawSolos = interaction.options.getString("solos");

    let teams;
    let soloPlayers;

    try {
      teams = parseTeams(rawDuos);
      soloPlayers = parseSoloPlayers(rawSolos);
    } catch (error) {
      return await interaction.editReply({
        content: `Could not parse entries.\n${error.message}`
      });
    }

    if (eventType === "duos_into_squads" && teams.length < 2) {
      return await interaction.editReply({
        content: "Add at least 2 duos before creating a scrim event."
      });
    }

    if (eventType === "duos_plus_solos_into_trios") {
      if (teams.length < 1 || soloPlayers.length < 1) {
        return await interaction.editReply({
          content: "Add at least 1 duo and 1 solo for a duos + solos into trios event."
        });
      }

      if (soloPlayers.length < teams.length) {
        return await interaction.editReply({
          content:
            "There are fewer solos than duos. Add more solos or remove duos so each trio can get one solo."
        });
      }
    }

    if (eventType === "solos_into_duos" && soloPlayers.length < 2) {
      return await interaction.editReply({
        content: "Add at least 2 solo players before creating a solos into duos event."
      });
    }

    const payload = {
      discordGuildId: interaction.guildId,
      discordChannelId: interaction.channelId,
      createdByDiscordId: interaction.user.id,
      eventName,
      eventType,
      games,
      teams,
      soloPlayers
    };

    const apiUrl = process.env.SCRIM_EVENTS_API_URL || DEFAULT_SCRIM_EVENTS_API_URL;
    const apiKey = process.env.SCRIM_EVENTS_API_KEY || process.env.DISCORD_SYNC_API_KEY;

    if (!apiUrl) {
      console.log("SCRIM EVENT PAYLOAD:", JSON.stringify(payload, null, 2));

      return await interaction.editReply({
        content:
          `${buildDiscordPreview(eventName, eventType, teams, soloPlayers)}\n\n` +
          "Website API is not configured yet. Set `SCRIM_EVENTS_API_URL` to send this event to the website."
      });
    }

    try {
      const response = await axios.post(apiUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        timeout: 15000
      });

      const adminUrl = response.data?.adminUrl;
      const eventId = response.data?.eventId;

      await interaction.editReply({
        content:
          `${buildDiscordPreview(eventName, eventType, teams, soloPlayers, adminUrl)}\n` +
          (eventId ? `Event ID: \`${eventId}\`` : "")
      });
    } catch (error) {
      console.error("Failed creating scrim event:", error.response?.data || error.message);

      await interaction.editReply({
        content:
          "Teams parsed successfully, but the website API did not accept the event. " +
          "Check `SCRIM_EVENTS_API_URL`, `DISCORD_SYNC_API_KEY`, and the website endpoint logs."
      });
    }
  }
};
