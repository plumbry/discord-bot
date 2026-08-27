const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const { userIsStaff } = require("../lib/staffPermissions");
const { getHighestGameNumber } = require("./gamecall");
const {
  CHOICES,
  SUPPORTED_GAMES,
  normalizeGameNumber,
  getGameSnapshot,
  listCaptains,
  resetEvent,
  setCaptains,
  upsertGame,
  setSelection,
  finalizeAndLock
} = require("../lib/dareToGreedStore");
const {
  sheetsConfigured,
  replaceCaptains,
  writeLockedColumn
} = require("../lib/dareToGreedSheet");

const CAPTAIN_ROLE_ID =
  process.env.DARE_TO_GREED_CAPTAIN_ROLE_ID || "1542531914051625210";

const PREFIX = "dtg:";
const CHALLENGE_MAX_LENGTH = 1500;
const DECISION_LINES = [
  "**You have 5 minutes to decide!**",
  "**If you don't react, you'll be marked safe!**"
].join("\n");

function customId(action, game) {
  return `${PREFIX}${action}:${game}`;
}

function parseCustomId(id) {
  if (!String(id || "").startsWith(PREFIX)) {
    return null;
  }

  const parts = String(id).split(":");
  const action = parts[1];
  const game = normalizeGameNumber(parts[2]);

  if (!action || !game) {
    return null;
  }

  return { action, game };
}

function memberDisplayName(member, user) {
  return (
    member?.displayName ||
    user?.globalName ||
    user?.username ||
    member?.user?.username ||
    "Unknown"
  );
}

function hasCaptainRole(member) {
  return Boolean(member?.roles?.cache?.has(CAPTAIN_ROLE_ID));
}

function canStaffControl(member) {
  return (
    userIsStaff(member) ||
    Boolean(member?.permissions?.has(PermissionFlagsBits.ModerateMembers))
  );
}

function canVote(member) {
  return hasCaptainRole(member) || canStaffControl(member);
}

function buildPublicEmbed(game, challengeText, locked) {
  return new EmbedBuilder()
    .setTitle("Dare to Greed")
    .setDescription(String(challengeText || "").trim() || "\u200b")
    .setColor(locked ? 0x95a5a6 : 0xf1c40f)
    .setFooter({
      text: locked ? `Game ${game} · Answers locked` : `Game ${game}`
    });
}

function buildVoteRow(game, locked) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId("safe", game))
      .setLabel("Safe")
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(locked)),
    new ButtonBuilder()
      .setCustomId(customId("greedy", game))
      .setLabel("Greedy")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(Boolean(locked))
  );
}

function buildStaffRow(game, locked) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId("edit", game))
      .setLabel("Edit")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(Boolean(locked)),
    new ButtonBuilder()
      .setCustomId(customId("lock", game))
      .setLabel("Lock")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(Boolean(locked))
  );
}

function roleMention(roleId) {
  return roleId ? `<@&${roleId}>` : "";
}

function buildPublicPayload(game, challengeText, locked, roleId, { ping = false } = {}) {
  const mention = roleMention(roleId);
  const content = mention ? `${mention}\n${DECISION_LINES}` : DECISION_LINES;

  return {
    content,
    embeds: [buildPublicEmbed(game, challengeText, locked)],
    components: [buildVoteRow(game, locked)],
    allowedMentions: {
      parse: [],
      roles: ping && roleId ? [roleId] : []
    }
  };
}

function challengeOption(option) {
  return option
    .setName("challenge")
    .setDescription("Challenge text to post")
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(CHALLENGE_MAX_LENGTH);
}

async function detectCurrentGame(channel) {
  const highest = await getHighestGameNumber(channel);
  const game = highest > 0 ? highest : 1;

  if (!SUPPORTED_GAMES.includes(game)) {
    const err = new Error(
      `Current game is ${game}, but Dare to Greed only supports games 1–4.`
    );
    err.code = "UNSUPPORTED_GAME";
    throw err;
  }

  return game;
}

async function fetchCaptainMembers(guild) {
  await guild.members.fetch();

  return [...guild.members.cache.values()]
    .filter(member => !member.user.bot && hasCaptainRole(member))
    .sort((a, b) =>
      memberDisplayName(a).localeCompare(memberDisplayName(b), undefined, {
        sensitivity: "base"
      })
    );
}

async function snapshotGame1Captains(guild) {
  if (!sheetsConfigured()) {
    throw new Error(
      "Google Sheets is not configured, so the Game 1 captain list cannot be written."
    );
  }

  const members = await fetchCaptainMembers(guild);

  if (!members.length) {
    throw new Error(
      `No members currently have the captain role. Game 1 cannot be started.`
    );
  }

  const captains = members.map(member => ({
    userId: member.id,
    displayName: memberDisplayName(member)
  }));

  const withRows = await replaceCaptains(captains);
  await setCaptains(guild.id, withRows);
  return withRows;
}

async function updatePublicMessage(client, gameState, game, challengeText, locked) {
  if (!gameState?.channelId || !gameState?.messageId) {
    return false;
  }

  try {
    const channel = await client.channels.fetch(gameState.channelId);
    const message = await channel.messages.fetch(gameState.messageId);
    await message.edit(
      buildPublicPayload(game, challengeText, locked, gameState.roleId, {
        ping: false
      })
    );
    return true;
  } catch (err) {
    console.warn(
      "[DARE TO GREED] could not update public message:",
      err?.message || err
    );
    return false;
  }
}

function formatNameList(names) {
  if (!names.length) {
    return "*None*";
  }

  const lines = names.map(name => `• ${name}`);
  let text = lines.join("\n");

  if (text.length <= 4000) {
    return text;
  }

  const kept = [];
  let used = 0;

  for (const line of lines) {
    const next = used + line.length + 1;

    if (next > 3900) {
      break;
    }

    kept.push(line);
    used = next;
  }

  const omitted = names.length - kept.length;
  return `${kept.join("\n")}\n…and ${omitted} more`;
}

function buildResultsEmbeds(game, captains, selections) {
  const safe = [];
  const greedy = [];

  for (const captain of captains) {
    const choice = selections[captain.userId] || CHOICES.SAFE;

    if (choice === CHOICES.GREEDY) {
      greedy.push(captain.displayName);
    } else {
      safe.push(captain.displayName);
    }
  }

  safe.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  greedy.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  return [
    new EmbedBuilder()
      .setTitle(`Game ${game} · SAFE`)
      .setColor(0x2ecc71)
      .setDescription(formatNameList(safe)),
    new EmbedBuilder()
      .setTitle(`Game ${game} · GREEDY`)
      .setColor(0xe74c3c)
      .setDescription(formatNameList(greedy))
  ];
}

function currentChoiceMessage(game, choice) {
  return `Your Game ${game} choice is currently: ${choice}`;
}

async function postOrEditChallenge({
  interaction,
  game,
  challengeText,
  existing,
  resetForNewEvent,
  roleId
}) {
  const guildId = interaction.guild.id;

  if (resetForNewEvent) {
    await resetEvent(guildId);
    await snapshotGame1Captains(interaction.guild);
  } else if (game === 1 && !listCaptains(guildId).length) {
    await snapshotGame1Captains(interaction.guild);
  } else if (game > 1 && !listCaptains(guildId).length) {
    throw new Error(
      "No Game 1 captain list exists yet. Start Dare to Greed for Game 1 first."
    );
  }

  const locked = Boolean(existing?.locked);
  const resolvedRoleId = roleId || existing?.roleId || "";
  let messageId = existing?.messageId || "";
  let channelId = existing?.channelId || interaction.channel.id;

  if (existing?.messageId && existing?.channelId) {
    const updated = await updatePublicMessage(
      interaction.client,
      { ...existing, roleId: resolvedRoleId },
      game,
      challengeText,
      locked
    );

    if (!updated) {
      const posted = await interaction.channel.send(
        buildPublicPayload(game, challengeText, locked, resolvedRoleId, {
          ping: true
        })
      );
      messageId = posted.id;
      channelId = posted.channel.id;
    }
  } else {
    const posted = await interaction.channel.send(
      buildPublicPayload(game, challengeText, locked, resolvedRoleId, {
        ping: true
      })
    );
    messageId = posted.id;
    channelId = posted.channel.id;
  }

  await upsertGame(guildId, game, {
    challengeText,
    channelId,
    messageId,
    roleId: resolvedRoleId,
    ...(existing ? {} : { locked: false })
  });

  const captains = listCaptains(guildId);
  const startedFresh = !existing || resetForNewEvent;
  const lines = [
    startedFresh
      ? `Dare to Greed Game ${game} posted.`
      : `Updated the Game ${game} Dare to Greed challenge.`
  ];

  if (game === 1 && (startedFresh || resetForNewEvent)) {
    lines.push(
      `Wrote ${captains.length} captain${captains.length === 1 ? "" : "s"} to the Dare to Greed sheet.`
    );
  }

  if (resetForNewEvent) {
    lines.push("Started a new event and replaced the previous captain list.");
  }

  return interaction.editReply({
    content: lines.join("\n"),
    components: locked ? [] : [buildStaffRow(game, false)]
  });
}

async function startChallenge(interaction) {
  const challengeText = interaction.options.getString("challenge", true).trim();
  const role = interaction.options.getRole("role", true);
  const game = await detectCurrentGame(interaction.channel);
  const existing = getGameSnapshot(interaction.guild.id, game);

  if (existing?.locked && game !== 1) {
    return interaction.editReply({
      content: `Game ${game} answers are already locked.`
    });
  }

  const resetForNewEvent = game === 1 && Boolean(existing?.locked);

  return postOrEditChallenge({
    interaction,
    game,
    challengeText,
    existing: resetForNewEvent ? null : existing,
    resetForNewEvent,
    roleId: role.id
  });
}

async function editChallenge(interaction, challengeText, gameNumber) {
  const game = gameNumber;
  const existing = getGameSnapshot(interaction.guild.id, game);

  if (!existing) {
    return interaction.editReply({
      content: `No Dare to Greed challenge found for Game ${game}.`
    });
  }

  if (existing.locked) {
    return interaction.editReply({
      content: `Game ${game} is locked and cannot be edited.`
    });
  }

  return postOrEditChallenge({
    interaction,
    game,
    challengeText,
    existing,
    resetForNewEvent: false
  });
}

async function resolveCaptainNames(guild, captains) {
  const resolved = [];

  for (const captain of captains) {
    const member = await guild.members.fetch(captain.userId).catch(() => null);

    resolved.push({
      ...captain,
      displayName: member ? memberDisplayName(member) : captain.displayName
    });
  }

  return resolved;
}

async function lockChallenge(interaction, gameNumber) {
  const game = gameNumber;
  const existing = getGameSnapshot(interaction.guild.id, game);

  if (!existing) {
    return interaction.editReply({
      content: `No Dare to Greed challenge found for Game ${game}.`
    });
  }

  const captains = listCaptains(interaction.guild.id);

  if (!captains.length) {
    return interaction.editReply({
      content:
        "No Game 1 captain list exists, so this game cannot be locked into the sheet."
    });
  }

  if (!sheetsConfigured()) {
    throw new Error(
      "Google Sheets is not configured, so locked answers cannot be written."
    );
  }

  const locked = await finalizeAndLock(
    interaction.guild.id,
    game,
    captains.map(captain => captain.userId)
  );

  await writeLockedColumn(
    game,
    captains.map(captain => ({
      rowNumber: captain.rowNumber,
      choice: locked.selections[captain.userId] || CHOICES.SAFE
    }))
  );

  const messageUpdated = await updatePublicMessage(
    interaction.client,
    locked,
    game,
    locked.challengeText,
    true
  );

  const namedCaptains = await resolveCaptainNames(interaction.guild, captains);
  let content = locked.alreadyLocked
    ? `Game ${game} is already locked. Final results:`
    : `Game ${game} answers locked. Anyone who did not choose was marked Safe.`;

  if (!messageUpdated) {
    content +=
      " The public buttons could not be disabled; the answers are still locked.";
  }

  return interaction.editReply({
    content,
    embeds: buildResultsEmbeds(game, namedCaptains, locked.selections),
    components: []
  });
}

function showEditModal(interaction, game, currentText) {
  const modal = new ModalBuilder()
    .setCustomId(customId("edit_modal", game))
    .setTitle(`Edit Game ${game} Challenge`);

  const input = new TextInputBuilder()
    .setCustomId("challenge_text")
    .setLabel("Challenge text")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(CHALLENGE_MAX_LENGTH);

  const prefills = String(currentText || "").trim().slice(0, CHALLENGE_MAX_LENGTH);

  if (prefills) {
    input.setValue(prefills);
  }

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("daretogreed")
    .setDescription("Start a Dare to Greed challenge for the current game")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption(challengeOption)
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Role to ping")
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: "Use this command in the server.",
        ephemeral: true
      });
    }

    if (!canStaffControl(interaction.member)) {
      return interaction.reply({
        content: "This command is staff-only.",
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      return await startChallenge(interaction);
    } catch (err) {
      console.error("[DARE TO GREED] command failed:", err);

      return interaction.editReply({
        content: err?.message || "Failed to run Dare to Greed."
      });
    }
  },

  async handleButton(interaction) {
    const parsed = parseCustomId(interaction.customId);

    if (!parsed) {
      return false;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Use this button in the server.",
        ephemeral: true
      });
      return true;
    }

    const member =
      interaction.member ||
      (await interaction.guild.members.fetch(interaction.user.id).catch(() => null));

    if (parsed.action === "safe" || parsed.action === "greedy") {
      if (!canVote(member)) {
        await interaction.reply({
          content: "Only captains, admins, and mods can use these buttons.",
          ephemeral: true
        });
        return true;
      }

      const choice =
        parsed.action === "greedy" ? CHOICES.GREEDY : CHOICES.SAFE;

      try {
        await setSelection(
          interaction.guild.id,
          parsed.game,
          interaction.user.id,
          choice
        );

        await interaction.reply({
          content: currentChoiceMessage(parsed.game, choice),
          ephemeral: true
        });
      } catch (err) {
        await interaction.reply({
          content:
            err?.code === "LOCKED"
              ? `Game ${parsed.game} answers are locked.`
              : err?.message || "Could not save that choice.",
          ephemeral: true
        });
      }

      return true;
    }

    if (parsed.action === "edit") {
      if (!canStaffControl(member)) {
        await interaction.reply({
          content: "Only admins and mods can edit this challenge.",
          ephemeral: true
        });
        return true;
      }

      const existing = getGameSnapshot(interaction.guild.id, parsed.game);

      if (!existing) {
        await interaction.reply({
          content: `No Dare to Greed challenge found for Game ${parsed.game}.`,
          ephemeral: true
        });
        return true;
      }

      if (existing.locked) {
        await interaction.reply({
          content: `Game ${parsed.game} is locked and cannot be edited.`,
          ephemeral: true
        });
        return true;
      }

      await showEditModal(interaction, parsed.game, existing.challengeText);
      return true;
    }

    if (parsed.action === "lock") {
      if (!canStaffControl(member)) {
        await interaction.reply({
          content: "Only admins and mods can lock answers.",
          ephemeral: true
        });
        return true;
      }

      await interaction.deferUpdate();

      try {
        await lockChallenge(interaction, parsed.game);
      } catch (err) {
        console.error("[DARE TO GREED] lock failed:", err);
        await interaction.editReply({
          content: err?.message || "Failed to lock answers.",
          components: [buildStaffRow(parsed.game, false)]
        });
      }

      return true;
    }

    return false;
  },

  async handleModalSubmit(interaction) {
    const parsed = parseCustomId(interaction.customId);

    if (!parsed || parsed.action !== "edit_modal") {
      return false;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Use this in the server.",
        ephemeral: true
      });
      return true;
    }

    if (!canStaffControl(interaction.member)) {
      await interaction.reply({
        content: "Only admins and mods can edit this challenge.",
        ephemeral: true
      });
      return true;
    }

    const challengeText = interaction.fields
      .getTextInputValue("challenge_text")
      .trim();

    if (!challengeText) {
      await interaction.reply({
        content: "Challenge text cannot be empty.",
        ephemeral: true
      });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      await editChallenge(interaction, challengeText, parsed.game);
    } catch (err) {
      console.error("[DARE TO GREED] edit modal failed:", err);
      await interaction.editReply({
        content: err?.message || "Failed to update the challenge."
      });
    }

    return true;
  }
};
