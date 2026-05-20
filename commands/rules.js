const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const {
  DEFAULT_TIER_RESTRICTIONS_URL,
  buildRulesMessage,
  buildBansMessage,
  normalizeBans,
  extraBansOnly,
  formatListInput
} = require("../lib/rulesTemplate");
const { getEvent, setEvent } = require("../lib/rulesStore");
const {
  listPresets,
  getPreset,
  setPreset
} = require("../lib/rulesSheet");
const {
  fetchGuildScheduledEvents,
  getSelectableScheduledEvents,
  buildAutocompleteChoices,
  formatRulesEventTime,
  resolveScheduledEvent
} = require("../lib/guildScheduledEvents");
const pendingRuleForms = new Map();
const BAN_FORM_LINE_COUNT = 5;

function sanitizeKey(raw) {
  return (raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_ ]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function deriveDefaultKey({ scheduledEventId, eventName, mode }) {
  if (scheduledEventId) {
    return sanitizeKey(`${scheduledEventId}-${mode}`) || "event-rules";
  }

  return sanitizeKey(`${eventName}-${mode}`) || "event-rules";
}

async function resolveRulesEvent(interaction, eventId) {
  const scheduledEvent = await resolveScheduledEvent(interaction.guild, eventId);

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

function parseItemList(input) {
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

function parseRulesLines(input) {
  return parseItemList(input);
}

function parseBanLineFields(fields, { requireFirst = false } = {}) {
  const lines = [];

  for (let i = 1; i <= BAN_FORM_LINE_COUNT; i++) {
    lines.push(fields.getTextInputValue(`ban_${i}`)?.trim() || "");
  }

  if (requireFirst && !lines[0]) {
    return { error: "Banned item 1 is required." };
  }

  return { lines: lines.filter(Boolean) };
}

function buildBanLineInput(index, value = "") {
  const input = new TextInputBuilder()
    .setCustomId(`ban_${index}`)
    .setLabel(`Banned item ${index}${index === 1 ? " (required)" : ""}`)
    .setStyle(TextInputStyle.Short)
    .setRequired(index === 1)
    .setMaxLength(200)
    .setPlaceholder(index === 1 ? "Required" : "Optional");

  if (value) {
    input.setValue(value.slice(0, 200));
  }

  return input;
}

function buildAddBanLineRow(key) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rules_add_ban:${key}`)
      .setLabel("Add ban line")
      .setStyle(ButtonStyle.Primary)
  );
}

function buildContinueBansRow(token) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rules_continue_bans:${token}`)
      .setLabel("Continue to banned items")
      .setStyle(ButtonStyle.Primary)
  );
}

function formatBansManageReply(key, bans, extra = "") {
  const effective = normalizeBans(bans);
  const lines = effective.map(item => `- ${item}`).join("\n");

  return (
    `**Key:** \`${key}\`\n` +
    `**Banned items (${effective.length}):**\n${lines}\n` +
    `Use **Add ban line** for more, or \`/rules bans key:${key}\` to edit the first ${BAN_FORM_LINE_COUNT}.` +
    extra
  );
}

async function applyBansUpdate(interaction, guildId, key, nextBans) {
  const eventRecord = getEvent(guildId, key);

  if (!eventRecord) {
    throw new Error("missing_event");
  }

  const normalized = normalizeBans(nextBans);
  const { channel, bansMessage } = await fetchTargetMessages(
    interaction,
    eventRecord
  );

  if (!channel || !bansMessage) {
    throw new Error("missing_message");
  }

  await bansMessage.edit({
    content: buildBansMessage({ bans: normalized }),
    allowedMentions: { parse: [] }
  });

  setEvent(guildId, key, { bans: normalized });
  return normalized;
}

function mergeBanFormLines(headLines, existingBans) {
  const tail = extraBansOnly(existingBans).slice(BAN_FORM_LINE_COUNT);
  return normalizeBans([...headLines, ...tail]);
}

function buildBanFormModal(customId, title, extraBans = []) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title);

  for (let i = 1; i <= BAN_FORM_LINE_COUNT; i++) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        buildBanLineInput(i, extraBans[i - 1] || "")
      )
    );
  }

  return modal;
}

function showBansFormModal(interaction, key, extraBans = []) {
  return interaction.showModal(
    buildBanFormModal(`rules_bans_form:${key}`, "Edit Banned Items", extraBans)
  );
}

function buildDetailsFormModal(customId, defaults = {}) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Event details");

  const streamInput = new TextInputBuilder()
    .setCustomId("stream_title")
    .setLabel("Stream title (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(150);

  if (defaults.streamTitle) {
    streamInput.setValue(defaults.streamTitle.slice(0, 150));
  }

  const perGameInput = new TextInputBuilder()
    .setCustomId("per_game_rules")
    .setLabel("Per-game rules (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1200);

  if (defaults.perGameRules) {
    perGameInput.setValue(defaults.perGameRules.slice(0, 1200));
  }

  const savePresetInput = new TextInputBuilder()
    .setCustomId("save_preset")
    .setLabel("Save as preset (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(64);

  modal.addComponents(
    new ActionRowBuilder().addComponents(streamInput),
    new ActionRowBuilder().addComponents(perGameInput),
    new ActionRowBuilder().addComponents(savePresetInput)
  );

  return modal;
}

function showAddBanLineModal(interaction, key) {
  const modal = new ModalBuilder()
    .setCustomId(`rules_add_ban:${key}`)
    .setTitle("Add Banned Item");

  const input = new TextInputBuilder()
    .setCustomId("new_ban")
    .setLabel("Banned item")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return interaction.showModal(modal);
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

function buildPresetChoices(presets, focused) {
  const query = focused.trim().toLowerCase();

  let filtered = presets;

  if (query) {
    filtered = presets.filter(preset => {
      const name = (preset.name || preset.key || "").toLowerCase();
      const key = (preset.key || "").toLowerCase();
      return name.includes(query) || key.includes(query);
    });
  }

  return filtered.slice(0, 25).map(preset => ({
    name: (preset.name || preset.key).slice(0, 100),
    value: preset.key
  }));
}

function buildPresetPayload({
  name,
  mode,
  eventType,
  tierRestrictionsUrl,
  streamTitle,
  perGameRules,
  bans,
  dropmapEnabled,
  separateDropmaps,
  dropmapExtraLine,
  firstPenalty,
  secondPenalty,
  thirdPenaltyText
}) {
  return {
    name,
    mode,
    eventType,
    tierRestrictionsUrl,
    streamTitle,
    perGameRules: Array.isArray(perGameRules) ? perGameRules : [],
    extraBans: extraBansOnly(bans),
    dropmapEnabled,
    separateDropmaps,
    dropmapExtraLine,
    firstPenalty,
    secondPenalty,
    thirdPenaltyText
  };
}

function resolveFormConfig(interaction, presetRecord = null) {
  const mode = interaction.options.getString("mode") || presetRecord?.mode;

  return {
    mode,
    eventType: presetRecord?.eventType || "standard",
    tierRestrictionsUrl:
      presetRecord?.tierRestrictionsUrl || DEFAULT_TIER_RESTRICTIONS_URL,
    dropmapEnabled: presetRecord?.dropmapEnabled ?? true,
    separateDropmaps: presetRecord?.separateDropmaps ?? false,
    dropmapExtraLine: presetRecord?.dropmapExtraLine || "",
    firstPenalty: presetRecord?.firstPenalty ?? 20,
    secondPenalty: presetRecord?.secondPenalty ?? 40,
    thirdPenaltyText: presetRecord?.thirdPenaltyText || "Disqualification",
    streamTitle: presetRecord?.streamTitle || "",
    perGameRules: presetRecord?.perGameRules || [],
    extraBans: presetRecord?.extraBans || []
  };
}

async function fetchTargetMessages(interaction, eventRecord) {
  const channel = await interaction.client.channels
    .fetch(eventRecord.channelId)
    .catch(() => null);

  if (!channel?.isTextBased?.()) {
    return { channel: null, bansMessage: null };
  }

  const bansMessage = await channel.messages
    .fetch(eventRecord.bansMessageId)
    .catch(() => null);

  return { channel, bansMessage };
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
    bans
  } = payload;

  const rulesContent = buildRulesMessage({
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
    thirdPenaltyText
  });
  const bansContent = buildBansMessage({ bans: normalizeBans(bans) });

  const rulesMessage = await interaction.channel.send({
    content: rulesContent,
    allowedMentions: { parse: [] }
  });
  const bansMessage = await interaction.channel.send({
    content: bansContent,
    allowedMentions: { parse: [] }
  });

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
    bans: normalizeBans(bans),
    channelId: interaction.channelId,
    rulesMessageId: rulesMessage.id,
    bansMessageId: bansMessage.id,
    createdAt: new Date().toISOString()
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
        .setDescription("Post rules for a scheduled event")
        .addStringOption(option =>
          option
            .setName("event")
            .setDescription("Scheduled event from the Events tab")
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName("mode")
            .setDescription("Game mode (optional if using preset)")
            .setRequired(false)
            .addChoices(
              { name: "Solo", value: "solo" },
              { name: "Duo", value: "duo" },
              { name: "Trio", value: "trio" },
              { name: "Squad", value: "squad" }
            )
        )
        .addStringOption(option =>
          option
            .setName("preset")
            .setDescription("Load settings from the Rules sheet")
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("bans")
        .setDescription("Edit banned items for a posted event")
        .addStringOption(option =>
          option
            .setName("key")
            .setDescription("Rules key from when you posted")
            .setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    try {
      if (focusedOption.name === "preset") {
        const presets = await listPresets(interaction.guildId);
        const choices = buildPresetChoices(presets, focusedOption.value);
        return await interaction.respond(choices);
      }

      const allEvents = await fetchGuildScheduledEvents(interaction.guild);
      const selectable = getSelectableScheduledEvents(allEvents);
      const choices = buildAutocompleteChoices(selectable, focusedOption.value);

      return await interaction.respond(choices);
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
      const key = sanitizeKey(interaction.options.getString("key", true));
      const eventRecord = getEvent(guildId, key);

      if (!eventRecord) {
        return interaction.reply({
          content:
            `No rules entry found for key \`${key}\`.\n` +
            "Post one first with `/rules form`.",
          ephemeral: true
        });
      }

      return showBansFormModal(
        interaction,
        key,
        extraBansOnly(eventRecord.bans)
      );
    }

    if (subcommand === "form") {
      const eventId = interaction.options.getString("event", true);
      const resolved = await resolveRulesEvent(interaction, eventId);

      if (resolved.error) {
        return interaction.reply({
          content: resolved.error,
          ephemeral: true
        });
      }

      const presetInput = interaction.options.getString("preset");
      const presetKey = sanitizeKey(presetInput || "");
      let presetRecord = null;

      if (presetInput) {
        try {
          presetRecord = presetKey ? await getPreset(guildId, presetKey) : null;
        } catch (err) {
          console.error("[RULES FORM PRESET]", err);
          return interaction.reply({
            content: sheetErrorMessage(err),
            ephemeral: true
          });
        }

        if (!presetRecord) {
          return interaction.reply({
            content: `No preset found for \`${presetKey}\` in the **Rules** sheet.`,
            ephemeral: true
          });
        }
      }

      const formConfig = resolveFormConfig(interaction, presetRecord);

      if (!formConfig.mode) {
        return interaction.reply({
          content:
            "Pick a **mode**, or load a preset that includes one with `preset:`",
          ephemeral: true
        });
      }

      const mode = formConfig.mode;
      const eventType = formConfig.eventType;
      const tierRestrictionsUrl = formConfig.tierRestrictionsUrl;
      const dropmapEnabled = formConfig.dropmapEnabled;
      const separateDropmaps = formConfig.separateDropmaps;
      const dropmapExtraLine = formConfig.dropmapExtraLine;
      const firstPenalty = formConfig.firstPenalty;
      const secondPenalty = formConfig.secondPenalty;
      const thirdPenaltyText = formConfig.thirdPenaltyText;
      const defaultKey = deriveDefaultKey({
        scheduledEventId: resolved.scheduledEventId,
        eventName: resolved.eventName,
        mode
      });

      const token = `${interaction.user.id}-${Date.now()}`;
      const defaultStreamTitle = formConfig.streamTitle || resolved.eventName;

      pendingRuleForms.set(token, {
        mode,
        eventType,
        tierRestrictionsUrl,
        dropmapEnabled,
        separateDropmaps,
        dropmapExtraLine,
        firstPenalty,
        secondPenalty,
        thirdPenaltyText,
        requestedKey: defaultKey,
        scheduledEventId: resolved.scheduledEventId,
        eventName: resolved.eventName,
        eventDateTime: resolved.eventDateTime,
        streamTitle: defaultStreamTitle,
        perGameRules: formConfig.perGameRules,
        savePresetRaw: "",
        extraBans: formConfig.extraBans,
        guildId: interaction.guildId,
        channelId: interaction.channelId
      });

      return interaction.showModal(
        buildDetailsFormModal(`rules_details_submit:${token}`, {
          streamTitle: defaultStreamTitle,
          perGameRules: formatListInput(formConfig.perGameRules)
        })
      );
    }
  },

  async handleButton(interaction) {
    if (interaction.customId.startsWith("rules_continue_bans:")) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This rules form expired. Please run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      await interaction.showModal(
        buildBanFormModal(
          `rules_form_submit:${token}`,
          "Banned Items",
          context.extraBans || []
        )
      );

      return true;
    }

    if (!interaction.customId.startsWith("rules_add_ban:")) {
      return false;
    }

    const key = sanitizeKey(interaction.customId.split(":")[1]);
    const eventRecord = getEvent(interaction.guildId, key);

    if (!eventRecord) {
      await interaction.reply({
        content: `No rules entry found for key \`${key}\`.`,
        ephemeral: true
      });
      return true;
    }

    await showAddBanLineModal(interaction, key);
    return true;
  },

  async handleModalSubmit(interaction) {
    if (interaction.customId.startsWith("rules_details_submit:")) {
      const token = interaction.customId.split(":")[1];
      const context = pendingRuleForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This rules form expired. Please run `/rules form` again.",
          ephemeral: true
        });
        return true;
      }

      const streamTitle =
        interaction.fields.getTextInputValue("stream_title")?.trim() ||
        context.streamTitle ||
        context.eventName;
      const perGameRules = parseRulesLines(
        interaction.fields.getTextInputValue("per_game_rules") || ""
      );
      const savePresetRaw =
        interaction.fields.getTextInputValue("save_preset")?.trim() || "";

      pendingRuleForms.set(token, {
        ...context,
        streamTitle,
        perGameRules,
        savePresetRaw
      });

      await interaction.reply({
        content: "Continue to enter banned items.",
        components: [buildContinueBansRow(token)],
        ephemeral: true
      });

      return true;
    }

    if (interaction.customId.startsWith("rules_add_ban:")) {
      const key = sanitizeKey(interaction.customId.split(":")[1]);
      const item = interaction.fields.getTextInputValue("new_ban")?.trim();

      if (!item) {
        await interaction.reply({
          content: "Banned item cannot be empty.",
          ephemeral: true
        });
        return true;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const eventRecord = getEvent(interaction.guildId, key);

        if (!eventRecord) {
          return interaction.editReply({
            content: `No rules entry found for key \`${key}\`.`
          });
        }

        const nextBans = normalizeBans([
          ...extraBansOnly(eventRecord.bans),
          item
        ]);
        await applyBansUpdate(interaction, interaction.guildId, key, nextBans);

        return interaction.editReply({
          content: formatBansManageReply(key, nextBans),
          components: [buildAddBanLineRow(key)]
        });
      } catch (err) {
        console.error("[RULES ADD BAN]", err);

        if (err.message === "missing_message") {
          return interaction.editReply({
            content: "Could not find the bans message to edit."
          });
        }

        return interaction.editReply({
          content: "Failed to add banned item."
        });
      }
    }

    if (interaction.customId.startsWith("rules_bans_form:")) {
      const key = sanitizeKey(interaction.customId.split(":")[1]);
      const parsed = parseBanLineFields(interaction.fields, { requireFirst: true });

      if (parsed.error) {
        await interaction.reply({
          content: parsed.error,
          ephemeral: true
        });
        return true;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const eventRecord = getEvent(interaction.guildId, key);

        if (!eventRecord) {
          return interaction.editReply({
            content: `No rules entry found for key \`${key}\`.`
          });
        }

        const nextBans = mergeBanFormLines(parsed.lines, eventRecord.bans);
        await applyBansUpdate(
          interaction,
          interaction.guildId,
          key,
          nextBans
        );

        return interaction.editReply({
          content: formatBansManageReply(key, nextBans),
          components: [buildAddBanLineRow(key)]
        });
      } catch (err) {
        console.error("[RULES BANS FORM]", err);

        if (err.message === "missing_message") {
          return interaction.editReply({
            content: "Could not find the bans message to edit."
          });
        }

        return interaction.editReply({
          content: "Failed to update banned items."
        });
      }
    }

    if (!interaction.customId.startsWith("rules_form_submit:")) {
      return false;
    }

    const token = interaction.customId.split(":")[1];
    const context = pendingRuleForms.get(token);
    pendingRuleForms.delete(token);

    if (!context) {
      await interaction.reply({
        content: "This rules form expired. Please run `/rules form` again.",
        ephemeral: true
      });
      return true;
    }

    const eventName = context.eventName;
    const eventDateTime = context.eventDateTime;
    const streamTitle = context.streamTitle || eventName;
    const savePresetRaw = context.savePresetRaw || "";
    const key = context.requestedKey;
    const parsed = parseBanLineFields(interaction.fields, { requireFirst: true });

    if (parsed.error) {
      await interaction.reply({
        content: parsed.error,
        ephemeral: true
      });
      return true;
    }

    const bans = normalizeBans(parsed.lines);
    const perGameRules = context.perGameRules || [];

    await interaction.deferReply({ ephemeral: true });

    await postRulesPack(interaction, {
      key,
      scheduledEventId: context.scheduledEventId,
      eventName,
      eventDateTime,
      mode: context.mode,
      eventType: context.eventType,
      tierRestrictionsUrl: context.tierRestrictionsUrl,
      streamTitle,
      perGameRules,
      dropmapEnabled: context.dropmapEnabled,
      separateDropmaps: context.separateDropmaps,
      dropmapExtraLine: context.dropmapExtraLine,
      firstPenalty: context.firstPenalty,
      secondPenalty: context.secondPenalty,
      thirdPenaltyText: context.thirdPenaltyText,
      bans
    });

    const savePresetKey = sanitizeKey(savePresetRaw);
    let presetSavedLine = "";

    if (savePresetKey) {
      try {
        await setPreset(context.guildId, savePresetKey, buildPresetPayload({
          name: savePresetRaw.trim(),
          mode: context.mode,
          eventType: context.eventType,
          tierRestrictionsUrl: context.tierRestrictionsUrl,
          streamTitle,
          perGameRules,
          bans,
          dropmapEnabled: context.dropmapEnabled,
          separateDropmaps: context.separateDropmaps,
          dropmapExtraLine: context.dropmapExtraLine,
          firstPenalty: context.firstPenalty,
          secondPenalty: context.secondPenalty,
          thirdPenaltyText: context.thirdPenaltyText
        }));

        presetSavedLine =
          `\nSaved preset **${savePresetRaw.trim()}** to the **Rules** sheet (\`${savePresetKey}\`).`;
      } catch (err) {
        console.error("[RULES SAVE PRESET]", err);
        presetSavedLine = `\n${sheetErrorMessage(err)}`;
      }
    }

    await interaction.editReply({
      content:
        `Posted rules for **${eventName}**.\n` +
        `Use key: \`${key}\`\n` +
        `Edit bans with \`/rules bans key:${key}\`` +
        presetSavedLine,
      components: [buildAddBanLineRow(key)]
    });

    return true;
  }
};
