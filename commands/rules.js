const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");
const {
  DEFAULT_TIER_RESTRICTIONS_URL,
  buildRulesMessage,
  buildBansMessage,
  normalizeBans,
  extraBansOnly,
  titleCaseMode,
  MODE_LABELS,
  formatListInput
} = require("../lib/rulesTemplate");
const { getRulesModules } = require("../lib/rulesModulesSheet");
const { getEvent, setEvent } = require("../lib/rulesStore");
const {
  sanitizeKey,
  appendUniqueStrings,
  saveTypedSuggestionsToLibrary,
  resolveBansTargetInChannel,
  applyBansUpdate,
  parseBansModalInput,
  buildBansFromExtraLines,
  formatBansEmbedValue,
  buildBanFormModal,
  showPendingAddBanModal,
  buildBanEditEmbed,
  buildEphemeralBanEditRow,
  getPendingExtraBans,
  recordPostedPackToSheet,
  PACK_TYPES,
  acknowledgeModalSilently,
  replyModalError,
  buildBansEditorFooterNotes,
  bansMessageDeletedUserMessage,
  formatBansPanelDescription
} = require("../lib/eventBansShared");
const {
  resolveGamePreset,
  formatGamePresetNotFoundMessage,
  isGameType
} = require("../lib/rulesGamePresets");
const {
  respondScheduledEventAutocomplete,
  resolveGuildForEvents,
  formatRulesEventTime,
  resolveScheduledEvent
} = require("../lib/guildScheduledEvents");

const RULES_PREFIX = "rules";
const pendingRuleForms = new Map();
const ephemeralBanEditCache = new Map();

function parseKillCapInput(raw) {
  const value = Number(String(raw ?? "").trim());

  if (!Number.isFinite(value) || value < 1 || value > 999) {
    return null;
  }

  return Math.floor(value);
}

function parseRulesListText(input) {
  if (!input?.trim()) {
    return [];
  }

  const seen = new Set();
  const out = [];

  for (const rawPart of input.split(/\n|,/g)) {
    const item = rawPart.trim();
    const lower = item.toLowerCase();

    if (!item || seen.has(lower)) {
      continue;
    }

    seen.add(lower);
    out.push(item);
  }

  return out;
}

function formatSpecialRulesEmbedValue(enabled, lines) {
  if (!enabled) {
    return "Off";
  }

  if (!lines?.length) {
    return "_On — tap **4b** or **Edit special** to add rules_";
  }

  return lines.map(item => `• ${item}`).join("\n").slice(0, 1024);
}

function buildSpecialRulesModal(token, lines = []) {
  const input = new TextInputBuilder()
    .setCustomId("special_rules_list")
    .setLabel("Special game rules")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(4000)
    .setPlaceholder("One rule per line (only posted when enabled)");

  const value = formatListInput(lines);

  if (value) {
    input.setValue(value.slice(0, 4000));
  }

  return new ModalBuilder()
    .setCustomId(`${RULES_PREFIX}_special_modal:${token}`)
    .setTitle("Special game rules")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function streamTitleButtonLabel(streamTitle) {
  if (!streamTitle?.trim()) {
    return "3b — Stream title";
  }

  const label = `3b — Stream: ${streamTitle.trim()}`;

  return label.length <= 80 ? label : `${label.slice(0, 77)}...`;
}

function buildStreamTitleModal(token, streamTitle = "") {
  const input = new TextInputBuilder()
    .setCustomId("stream_title")
    .setLabel("Twitch stream title")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(140)
    .setPlaceholder("Exact title streamers must use");

  const value = streamTitle?.trim();

  if (value) {
    input.setValue(value.slice(0, 140));
  }

  return new ModalBuilder()
    .setCustomId(`${RULES_PREFIX}_stream_title_modal:${token}`)
    .setTitle("Stream title")
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function buildKillCapModal(token, currentCap) {
  return new ModalBuilder()
    .setCustomId(`${RULES_PREFIX}_killcap_modal:${token}`)
    .setTitle("Kill cap")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("kill_cap")
          .setLabel("Max kills (number)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 12")
          .setRequired(true)
          .setMaxLength(4)
          .setValue(currentCap != null ? String(currentCap) : "12")
      )
    );
}

function deriveDefaultKey({ scheduledEventId, eventName, mode }) {
  if (scheduledEventId) {
    return sanitizeKey(`${scheduledEventId}-${mode}`) || "event-rules";
  }

  return sanitizeKey(`${eventName}-${mode}`) || "event-rules";
}

async function resolveRulesEvent(interaction, eventId) {
  const guild = await resolveGuildForEvents(interaction.client, interaction);
  const scheduledEvent = guild
    ? await resolveScheduledEvent(guild, eventId)
    : null;

  if (!scheduledEvent) {
    return {
      error:
        "Could not find that scheduled event.\n\n" +
        "• Choose **event** from the dropdown (don't type the name)\n" +
        "• The event must still exist on the server **Events** tab"
    };
  }

  return {
    scheduledEvent,
    scheduledEventId: scheduledEvent.id,
    eventName: scheduledEvent.name,
    eventDateTime: formatRulesEventTime(scheduledEvent.scheduledStartAt)
  };
}

function sheetErrorMessage(err) {
  if (err?.message?.includes("MAIN_SHEET_ID")) {
    return "MAIN_SHEET_ID is not configured — cannot use the **Rules** sheet.";
  }

  return (
    "Could not access the **Rules** sheet. " +
    "Check the tab exists with the correct headers and the bot has sheet access."
  );
}

function applyGamePresetToContext(context, gamePreset, gameKey) {
  context.gameKey = gameKey;
  context.gameLabel = gamePreset.gameLabel;
  context.pendingBans = extraBansOnly(gamePreset.extraBans || []);
  context.eventType = gamePreset.eventType || "standard";
  context.tierRestrictionsUrl =
    gamePreset.tierRestrictionsUrl || DEFAULT_TIER_RESTRICTIONS_URL;
  context.separateDropmaps = gamePreset.separateDropmaps ?? false;
  context.dropmapExtraLine = gamePreset.dropmapExtraLine || "";
  context.firstPenalty = gamePreset.firstPenalty;
  context.secondPenalty = gamePreset.secondPenalty;
  context.thirdPenaltyText = gamePreset.thirdPenaltyText;
}

function formatLabel(value, labels = {}) {
  if (!value) {
    return "_Not set_";
  }

  return labels[value] || titleCaseMode(value);
}

function buildRulesSetupEmbed(context) {
  const extraBans = getPendingExtraBans(context);
  return new EmbedBuilder()
    .setTitle(`Rules setup — ${context.eventName}`)
    .setDescription(
      formatBansPanelDescription(
        "Use the rows below, then **Preview rules** or **Post rules**.\n" +
          "Section text is edited on the **Rules Modules** sheet (one row per module).\n" +
          "**1** Game · **2** Format · **3** Kill cap & stream title · **4** Dropmap & special rules"
      )
    )
    .setColor(0x5865f2)
    .addFields(
      {
        name: "Always banned",
        value:
          "Any weapon that uses **SNIPER** or **EXPLOSIVE** ammo — always in the posted ban list.",
        inline: false
      },
      { name: "When", value: context.eventDateTime, inline: true },
      {
        name: "Game",
        value: context.gameLabel || "_Pick game_",
        inline: true
      },
      {
        name: "Format",
        value: formatLabel(context.formatMode, MODE_LABELS),
        inline: true
      },
      {
        name: "Kill cap",
        value: context.killCap ? String(context.killCap) : "_Tap **3a — Kill cap** below_",
        inline: true
      },
      {
        name: "Stream title",
        value: context.streamTitle?.trim()
          ? context.streamTitle.trim()
          : "_Tap **3b — Stream title** below_",
        inline: true
      },
      {
        name: "Dropmap",
        value: context.dropmapEnabled == null ? "_Pick_" : context.dropmapEnabled ? "On" : "Off",
        inline: true
      },
      {
        name: "Special game rules",
        value: formatSpecialRulesEmbedValue(
          context.specialGameRulesEnabled,
          context.specialGameRules
        ),
        inline: false
      },
      {
        name: "Penalties",
        value: context.gameKey
          ? `**-${context.firstPenalty}** / **-${context.secondPenalty}** / ${context.thirdPenaltyText}`
          : "_Pick game_",
        inline: false
      },
      {
        name: "Extra bans",
        value: formatBansEmbedValue(extraBans),
        inline: false
      }
    );
}

async function buildRulesSetupComponents(token, context, guildId) {
  const rows = [];

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${RULES_PREFIX}_game:${token}`)
        .setPlaceholder("1 — Game type (Main BR or Reload)")
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("Main BR")
            .setValue("br")
            .setDefault(context.gameKey === "br"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Reload")
            .setValue("reload")
            .setDefault(context.gameKey === "reload")
        )
    )
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${RULES_PREFIX}_format:${token}`)
        .setPlaceholder("2 — Format (Duos, Trios, or Squads)")
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel("Duos")
            .setValue("duo")
            .setDefault(context.formatMode === "duo"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Trios")
            .setValue("trio")
            .setDefault(context.formatMode === "trio"),
          new StringSelectMenuOptionBuilder()
            .setLabel("Squads")
            .setValue("squad")
            .setDefault(context.formatMode === "squad")
        )
    )
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${RULES_PREFIX}_killcap_set:${token}`)
        .setLabel(
          context.killCap != null
            ? `3a — Kill cap: ${context.killCap}`
            : "3a — Kill cap"
        )
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${RULES_PREFIX}_stream_title_set:${token}`)
        .setLabel(streamTitleButtonLabel(context.streamTitle))
        .setStyle(
          context.streamTitle?.trim()
            ? ButtonStyle.Success
            : ButtonStyle.Secondary
        )
    )
  );

  const toggleRow = [
    new ButtonBuilder()
      .setCustomId(`${RULES_PREFIX}_toggle_dropmap:${token}`)
      .setLabel(
        context.dropmapEnabled == null
          ? "4a — Dropmap"
          : context.dropmapEnabled
            ? "4a — Dropmap: On"
            : "4a — Dropmap: Off"
      )
      .setStyle(
        context.dropmapEnabled ? ButtonStyle.Success : ButtonStyle.Secondary
      ),
    new ButtonBuilder()
      .setCustomId(`${RULES_PREFIX}_toggle_special_rules:${token}`)
      .setLabel(
        context.specialGameRulesEnabled
          ? "4b — Special rules: On"
          : "4b — Special rules: Off"
      )
      .setStyle(
        context.specialGameRulesEnabled
          ? ButtonStyle.Success
          : ButtonStyle.Secondary
      )
  ];

  if (context.specialGameRulesEnabled) {
    toggleRow.push(
      new ButtonBuilder()
        .setCustomId(`${RULES_PREFIX}_special_edit:${token}`)
        .setLabel("Edit special")
        .setStyle(ButtonStyle.Primary)
    );
  }

  rows.push(new ActionRowBuilder().addComponents(...toggleRow));

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${RULES_PREFIX}_setup_bans:${token}`)
        .setLabel("Edit ban list")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!context.gameKey),
      new ButtonBuilder()
        .setCustomId(`${RULES_PREFIX}_setup_add_ban:${token}`)
        .setLabel("+ Add one")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!context.gameKey),
      new ButtonBuilder()
        .setCustomId(`${RULES_PREFIX}_preview:${token}`)
        .setLabel("Preview rules")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${RULES_PREFIX}_post:${token}`)
        .setLabel("Post rules")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${RULES_PREFIX}_cancel:${token}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return rows.slice(0, 5);
}

async function refreshRulesSetupEphemeral(interaction, context) {
  await interaction.update({
    embeds: [buildRulesSetupEmbed(context)],
    components: await buildRulesSetupComponents(
      context.token,
      context,
      context.guildId
    )
  });
}

function buildRulesPostedEmbed(eventName) {
  return new EmbedBuilder()
    .setTitle(`Posted — ${eventName}`)
    .setDescription(
      "Rules and bans are in this channel.\n" +
        "Use `/rules bans` here to edit the ban list."
    )
    .setColor(0x57f287);
}

function validateContextForPost(context) {
  if (!context.gameKey) {
    return "Pick a **game type** (Main BR or Reload).";
  }

  if (!context.formatMode) {
    return "Pick a **format** (Duos, Trios, or Squads).";
  }

  if (context.killCap == null || !parseKillCapInput(context.killCap)) {
    return "Set a **kill cap** (tap **3a — Kill cap** and enter a number).";
  }

  if (!context.streamTitle?.trim()) {
    return "Set a **stream title** (tap **3b — Stream title**).";
  }

  if (context.dropmapEnabled == null) {
    return "Pick **dropmap** on or off.";
  }

  if (
    context.specialGameRulesEnabled &&
    !(context.specialGameRules || []).length
  ) {
    return (
      "Add at least one line in **Special game rules** (tap **4b** or **Edit special**), " +
        "or turn **4b** off."
    );
  }

  return null;
}

function buildPreviewPayloadFromContext(context) {
  return {
    eventName: context.eventName,
    eventDateTime: context.eventDateTime,
    mode: context.formatMode || "duo",
    eventType: context.eventType,
    tierRestrictionsUrl: context.tierRestrictionsUrl,
    streamTitle: context.streamTitle?.trim() || "_(not set)_",
    perGameRules: context.specialGameRulesEnabled
      ? context.specialGameRules || []
      : [],
    dropmapEnabled: context.dropmapEnabled ?? true,
    separateDropmaps: context.separateDropmaps,
    dropmapExtraLine: context.dropmapExtraLine,
    firstPenalty: context.firstPenalty,
    secondPenalty: context.secondPenalty,
    thirdPenaltyText: context.thirdPenaltyText,
    killCap: parseKillCapInput(context.killCap),
    gameLabel: context.gameLabel || "_(not set)_"
  };
}

async function loadSheetModulesForContext(context) {
  try {
    return await getRulesModules(context.guildId, context.gameKey || "");
  } catch (err) {
    console.error("[RULES MODULES]", err?.message || err);
    return null;
  }
}

async function replyRulesPreview(interaction, context) {
  const validationError = validateContextForPost(context);
  const sheetModules = await loadSheetModulesForContext(context);
  const previewText = buildRulesMessage({
    ...buildPreviewPayloadFromContext(context),
    sheetModules
  });
  const chunks = splitDiscordContent(
    previewText,
    DISCORD_CONTENT_LIMIT,
    "Rules preview"
  );
  const prefix = validationError
    ? `**Rules preview** — not ready to post yet: ${validationError}\n\n`
    : "**Rules preview** — this is what will be posted:\n\n";

  await interaction.reply({
    content: `${prefix}${chunks[0]}`.slice(0, DISCORD_CONTENT_LIMIT),
    ephemeral: true
  });

  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp({
      content: chunks[i].slice(0, DISCORD_CONTENT_LIMIT),
      ephemeral: true
    });
  }
}

function buildPostPayloadFromContext(context) {
  return {
    key: deriveDefaultKey({
      scheduledEventId: context.scheduledEventId,
      eventName: context.eventName,
      mode: context.formatMode
    }),
    scheduledEventId: context.scheduledEventId,
    eventName: context.eventName,
    eventDateTime: context.eventDateTime,
    mode: context.formatMode,
    eventType: context.eventType,
    tierRestrictionsUrl: context.tierRestrictionsUrl,
    streamTitle: context.streamTitle.trim(),
    perGameRules: context.specialGameRulesEnabled
      ? context.specialGameRules || []
      : [],
    dropmapEnabled: context.dropmapEnabled,
    separateDropmaps: context.separateDropmaps,
    dropmapExtraLine: context.dropmapExtraLine,
    firstPenalty: context.firstPenalty,
    secondPenalty: context.secondPenalty,
    thirdPenaltyText: context.thirdPenaltyText,
    killCap: context.killCap,
    gameLabel: context.gameLabel,
    gameKey: context.gameKey,
    bans: normalizeBans(getPendingExtraBans(context))
  };
}

const DISCORD_CONTENT_LIMIT = 2000;

function splitDiscordContent(content, limit = DISCORD_CONTENT_LIMIT, continuedTitle = "Rules") {
  if (content.length <= limit) {
    return [content];
  }

  const chunks = [];
  let current = "";

  for (const line of content.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (line.length <= limit) {
      current = line;
      continue;
    }

    for (let offset = 0; offset < line.length; offset += limit) {
      chunks.push(line.slice(offset, offset + limit));
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.map((chunk, index) => {
    if (index === 0) {
      return chunk;
    }

    return `## ${continuedTitle} (continued ${index + 1})\n\n${chunk}`;
  });
}

async function sendRulesMessages(channel, content, continuedTitle) {
  const chunks = splitDiscordContent(content, DISCORD_CONTENT_LIMIT, continuedTitle);
  const messages = [];

  for (const chunk of chunks) {
    messages.push(
      await channel.send({
        content: chunk,
        allowedMentions: { parse: [] }
      })
    );
  }

  return messages;
}

async function postRulesPack(interaction, payload) {
  const {
    key,
    scheduledEventId,
    eventName,
    eventDateTime,
    mode,
    eventType,
    tierRestrictionsUrl,
    streamTitle,
    perGameRules,
    dropmapEnabled,
    separateDropmaps,
    dropmapExtraLine,
    firstPenalty,
    secondPenalty,
    thirdPenaltyText,
    killCap,
    gameLabel,
    gameKey,
    bans
  } = payload;

  const sheetModules = await loadSheetModulesForContext({
    guildId: interaction.guildId,
    gameKey: gameKey || ""
  });

  const rulesContent = buildRulesMessage({
    eventName,
    eventDateTime,
    mode,
    tierRestrictionsUrl,
    streamTitle,
    perGameRules,
    dropmapEnabled,
    separateDropmaps,
    dropmapExtraLine,
    firstPenalty,
    secondPenalty,
    thirdPenaltyText,
    killCap,
    gameLabel,
    sheetModules
  });
  const bansContent = buildBansMessage({ bans: normalizeBans(bans) });

  const rulesMessages = await sendRulesMessages(
    interaction.channel,
    rulesContent,
    eventName
  );
  const rulesMessage = rulesMessages[0];
  const bansMessage = await interaction.channel.send({
    content: bansContent,
    allowedMentions: { parse: [] }
  });

  const createdAt = new Date().toISOString();

  setEvent(interaction.guildId, key, {
    key,
    scheduledEventId,
    eventName,
    eventDateTime,
    mode,
    eventType,
    tierRestrictionsUrl,
    streamTitle,
    perGameRules,
    dropmapEnabled,
    separateDropmaps,
    dropmapExtraLine,
    firstPenalty,
    secondPenalty,
    thirdPenaltyText,
    killCap,
    gameLabel,
    bans: normalizeBans(bans),
    channelId: interaction.channelId,
    rulesMessageId: rulesMessage.id,
    bansMessageId: bansMessage.id,
    packType: PACK_TYPES.RULES,
    createdAt
  });

  await recordPostedPackToSheet({
    guildId: interaction.guildId,
    key,
    scheduledEventId,
    packType: PACK_TYPES.RULES,
    mode,
    eventName,
    channelId: interaction.channelId,
    rulesMessageId: rulesMessage.id,
    bansMessageId: bansMessage.id,
    postedAt: createdAt
  });

  saveTypedSuggestionsToLibrary(interaction.guildId, {
    bans: extraBansOnly(bans),
    rules: perGameRules
  });

  return key;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rules")
    .setDescription("Post and manage event rules + banned items")
    .addSubcommand(sub =>
      sub
        .setName("form")
        .setDescription("Post rules for a scheduled event (ephemeral setup)")
        .addStringOption(option =>
          option
            .setName("event")
            .setDescription("Scheduled event from the Events tab")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("bans")
        .setDescription(
          "Edit the ban list where you posted rules (this channel)"
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async autocomplete(interaction) {
    let focusedValue = "";

    try {
      focusedValue = interaction.options.getFocused() ?? "";
    } catch {
      focusedValue = "";
    }

    try {
      return await respondScheduledEventAutocomplete(
        interaction,
        focusedValue
      );
    } catch (err) {
      console.error("[RULES AUTOCOMPLETE]", err);

      if (interaction.responded) {
        return;
      }

      return interaction.respond([]).catch(() => {});
    }
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (subcommand === "bans") {
      await interaction.deferReply({ ephemeral: true });

      const resolved = await resolveBansTargetInChannel(interaction);

      if (!resolved) {
        return interaction.editReply({
          content:
            "No banned-items message found in this channel.\n\n" +
            "Post with `/rules form` or `/bans post`, or run `/bans edit` or `/rules bans` where bans were posted."
        });
      }

      if (resolved.bansMessageDeleted) {
        return interaction.editReply({
          content: bansMessageDeletedUserMessage(resolved.eventRecord.eventName)
        });
      }

      const { key, eventRecord, multipleInChannel, recoveredFromMessage } =
        resolved;

      if (recoveredFromMessage) {
        setEvent(guildId, key, eventRecord);
      }

      const token = `${interaction.user.id}-${Date.now()}`;

      ephemeralBanEditCache.set(token, {
        key,
        guildId,
        userId: interaction.user.id
      });

      const footerNote = buildBansEditorFooterNotes({
        multipleInChannel,
        recoveredFromMessage
      });

      return interaction.editReply({
        embeds: [buildBanEditEmbed(eventRecord, { footerNote })],
        components: [buildEphemeralBanEditRow(RULES_PREFIX, token)]
      });
    }

    if (subcommand === "form") {
      await interaction.deferReply({ ephemeral: true });

      const eventId = interaction.options.getString("event", true);
      const resolved = await resolveRulesEvent(interaction, eventId);

      if (resolved.error) {
        return interaction.editReply({
          content: resolved.error
        });
      }

      const token = `${interaction.user.id}-${Date.now()}`;

      const context = {
        token,
        guildId,
        channelId: interaction.channelId,
        scheduledEventId: resolved.scheduledEventId,
        eventName: resolved.eventName,
        eventDateTime: resolved.eventDateTime,
        gameKey: null,
        gameLabel: null,
        formatMode: null,
        killCap: 12,
        streamTitle: "",
        dropmapEnabled: true,
        specialGameRulesEnabled: false,
        specialGameRules: [],
        pendingBans: [],
        eventType: "standard",
        tierRestrictionsUrl: DEFAULT_TIER_RESTRICTIONS_URL,
        separateDropmaps: false,
        dropmapExtraLine: "",
        firstPenalty: 20,
        secondPenalty: 40,
        thirdPenaltyText: "Disqualification",
        savedBanOptions: []
      };

      pendingRuleForms.set(token, context);

      return interaction.editReply({
        embeds: [buildRulesSetupEmbed(context)],
        components: await buildRulesSetupComponents(
          token,
          context,
          guildId
        )
      });
    }
  },

  async handleSelectMenu(interaction) {
    if (interaction.customId.startsWith(`${RULES_PREFIX}_game:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);
      const gameKey = interaction.values[0];

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      if (!isGameType(gameKey)) {
        return true;
      }

      try {
        const gamePreset = await resolveGamePreset(context.guildId, gameKey);

        if (!gamePreset) {
          await interaction.reply({
            content: formatGamePresetNotFoundMessage(gameKey, context.guildId),
            ephemeral: true
          });
          return true;
        }

        applyGamePresetToContext(context, gamePreset, gameKey);
        saveTypedSuggestionsToLibrary(context.guildId, {
          bans: extraBansOnly(context.pendingBans)
        });
        pendingRuleForms.set(token, context);
        await refreshRulesSetupEphemeral(interaction, context);
      } catch (err) {
        console.error("[RULES GAME SELECT]", err);
        await interaction.reply({
          content: sheetErrorMessage(err),
          ephemeral: true
        });
      }

      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_format:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      context.formatMode = interaction.values[0];
      pendingRuleForms.set(token, context);
      await refreshRulesSetupEphemeral(interaction, context);
      return true;
    }

    return false;
  },

  async handleButton(interaction) {
    if (interaction.customId.startsWith(`${RULES_PREFIX}_killcap_set:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      await interaction.showModal(buildKillCapModal(token, context.killCap));
      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_stream_title_set:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      await interaction.showModal(
        buildStreamTitleModal(token, context.streamTitle)
      );
      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_toggle_dropmap:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      context.dropmapEnabled = !context.dropmapEnabled;
      pendingRuleForms.set(token, context);
      await refreshRulesSetupEphemeral(interaction, context);
      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_toggle_special_rules:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      if (!context.specialGameRulesEnabled) {
        await interaction.showModal(
          buildSpecialRulesModal(token, context.specialGameRules || [])
        );
        return true;
      }

      context.specialGameRulesEnabled = false;
      pendingRuleForms.set(token, context);
      await refreshRulesSetupEphemeral(interaction, context);
      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_special_edit:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      await interaction.showModal(
        buildSpecialRulesModal(token, context.specialGameRules || [])
      );
      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_preview:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      await replyRulesPreview(interaction, context);
      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_cancel:`)) {
      const token = interaction.customId.split(":")[1];
      pendingRuleForms.delete(token);

      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("Cancelled")
            .setDescription("Nothing was posted.")
            .setColor(0x99aab5)
        ],
        components: []
      });

      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_edit_ephemeral:`)) {
      const token = interaction.customId.split(":")[1];
      const cached = ephemeralBanEditCache.get(token);

      if (
        !cached ||
        cached.userId !== interaction.user.id ||
        cached.guildId !== interaction.guildId
      ) {
        await interaction.reply({
          content: "This edit session expired. Run `/rules bans` again.",
          ephemeral: true
        });
        return true;
      }

      const eventRecord = getEvent(cached.guildId, cached.key);

      if (!eventRecord) {
        ephemeralBanEditCache.delete(token);
        await interaction.reply({
          content: "No ban pack found. Run `/rules bans` again.",
          ephemeral: true
        });
        return true;
      }

      await interaction.showModal(
        buildBanFormModal(
          `${RULES_PREFIX}_bans_form:${cached.key}`,
          "Edit ban list",
          extraBansOnly(eventRecord.bans)
        )
      );

      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_setup_bans:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      await interaction.showModal(
        buildBanFormModal(
          `${RULES_PREFIX}_form_submit:${token}`,
          "Ban list",
          getPendingExtraBans(context)
        )
      );

      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_setup_add_ban:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      await showPendingAddBanModal(interaction, RULES_PREFIX, token);
      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_post:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      const validationError = validateContextForPost(context);

      if (validationError) {
        await interaction.reply({
          content: validationError,
          ephemeral: true
        });
        return true;
      }

      try {
        await postRulesPack(interaction, buildPostPayloadFromContext(context));
      } catch (err) {
        console.error("[RULES POST]", err?.message || err, err?.stack);

        const hint =
          err?.code === 50035 || /2000|length/i.test(String(err?.message))
            ? "The rules text is too long for one Discord message; try again after deploy, or shorten special rules."
            : "Failed to post rules. Try again.";

        await interaction.update({
          embeds: [
            buildRulesSetupEmbed(context),
            new EmbedBuilder()
              .setTitle("Post failed")
              .setDescription(hint)
              .setColor(0xed4245)
          ],
          components: await buildRulesSetupComponents(
            context.token,
            context,
            context.guildId
          )
        });
        return true;
      }

      pendingRuleForms.delete(token);

      await interaction.update({
        embeds: [buildRulesPostedEmbed(context.eventName)],
        components: []
      });

      return true;
    }

    return false;
  },

  async handleModalSubmit(interaction) {
    if (interaction.customId.startsWith(`${RULES_PREFIX}_stream_title_modal:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      const streamTitle = interaction.fields.getTextInputValue("stream_title")?.trim();

      if (!streamTitle) {
        return replyModalError(interaction, "Stream title cannot be empty.");
      }

      context.streamTitle = streamTitle.slice(0, 140);
      pendingRuleForms.set(token, context);
      await refreshRulesSetupEphemeral(interaction, context);
      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_special_modal:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      const lines = parseRulesListText(
        interaction.fields.getTextInputValue("special_rules_list")
      );

      if (!lines.length) {
        context.specialGameRules = [];
        context.specialGameRulesEnabled = false;
      } else {
        context.specialGameRules = lines;
        context.specialGameRulesEnabled = true;
      }

      pendingRuleForms.set(token, context);
      await refreshRulesSetupEphemeral(interaction, context);
      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_killcap_modal:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      const killCap = parseKillCapInput(
        interaction.fields.getTextInputValue("kill_cap")
      );

      if (killCap == null) {
        return replyModalError(
          interaction,
          "Enter a whole number from **1** to **999** for the kill cap."
        );
      }

      context.killCap = killCap;
      pendingRuleForms.set(token, context);
      await refreshRulesSetupEphemeral(interaction, context);
      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_form_submit:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      const parsed = parseBansModalInput(interaction.fields);
      context.pendingBans = parsed.lines;
      saveTypedSuggestionsToLibrary(context.guildId, { bans: parsed.lines });
      pendingRuleForms.set(token, context);
      await refreshRulesSetupEphemeral(interaction, context);
      return true;
    }

    if (interaction.customId.startsWith(`${RULES_PREFIX}_pending_add_ban:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      const item = interaction.fields.getTextInputValue("new_ban")?.trim();

      if (!item) {
        await interaction.reply({
          content: "Banned item cannot be empty.",
          ephemeral: true
        });
        return true;
      }

      context.pendingBans = appendUniqueStrings(
        getPendingExtraBans(context),
        [item]
      );
      saveTypedSuggestionsToLibrary(context.guildId, { bans: [item] });
      pendingRuleForms.set(token, context);
      await refreshRulesSetupEphemeral(interaction, context);
      return true;
    }

    if (!interaction.customId.startsWith(`${RULES_PREFIX}_bans_form:`)) {
      return false;
    }

    const key = sanitizeKey(interaction.customId.split(":")[1]);
    const parsed = parseBansModalInput(interaction.fields);

    await interaction.deferReply({ ephemeral: true });

    let eventRecord;

    try {
      eventRecord = getEvent(interaction.guildId, key);

      if (!eventRecord) {
        return replyModalError(
          interaction,
          `No rules entry found for key \`${key}\`.`
        );
      }

      const nextBans = buildBansFromExtraLines(parsed.lines);
      await applyBansUpdate(interaction, interaction.guildId, key, nextBans);
      saveTypedSuggestionsToLibrary(interaction.guildId, {
        bans: extraBansOnly(nextBans)
      });
      await acknowledgeModalSilently(interaction);
    } catch (err) {
      console.error("[RULES BANS FORM]", err);

      if (err.message === "bans_message_deleted") {
        return replyModalError(
          interaction,
          bansMessageDeletedUserMessage(eventRecord?.eventName)
        );
      }

      return replyModalError(interaction, "Failed to update banned items.");
    }

    return true;
  }
};
