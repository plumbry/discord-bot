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
  isDefaultBan,
  extraBansOnly,
  formatListInput
} = require("../lib/rulesTemplate");
const { getEvent, setEvent } = require("../lib/rulesStore");
const {
  listPresets,
  getPreset,
  setPreset,
  deletePreset
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

function removeItemCaseInsensitive(items, removeValue) {
  const target = removeValue.trim().toLowerCase();
  return items.filter(item => item.toLowerCase() !== target);
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

function formatBansManageReply(key, bans, extra = "") {
  const effective = normalizeBans(bans);
  const lines = effective.map(item => `- ${item}`).join("\n");

  return (
    `**Key:** \`${key}\`\n` +
    `**Banned items (${effective.length}):**\n${lines}\n` +
    `Use **Add ban line** for more, or \`/rules bans form key:${key}\` to edit the first ${BAN_FORM_LINE_COUNT}.` +
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
  const eventType =
    interaction.options.getString("event_type") ||
    presetRecord?.eventType ||
    "standard";
  const tierRestrictionsUrl =
    interaction.options.getString("tier_link") ||
    presetRecord?.tierRestrictionsUrl ||
    DEFAULT_TIER_RESTRICTIONS_URL;

  const noDropmap = interaction.options.getBoolean("no_dropmap");
  const dropmapEnabled =
    noDropmap === null
      ? presetRecord?.dropmapEnabled ?? true
      : !noDropmap;

  const separateDropmapOption = interaction.options.getBoolean("separate_dropmap");
  const separateDropmaps =
    separateDropmapOption === null
      ? presetRecord?.separateDropmaps ?? false
      : separateDropmapOption;

  const dropmapNoteOption = interaction.options.getString("dropmap_note");
  const dropmapExtraLine =
    dropmapNoteOption === null
      ? presetRecord?.dropmapExtraLine || ""
      : dropmapNoteOption;

  const penalty1Option = interaction.options.getInteger("penalty_1");
  const penalty2Option = interaction.options.getInteger("penalty_2");
  const penalty3Option = interaction.options.getString("penalty_3");

  return {
    mode,
    eventType,
    tierRestrictionsUrl,
    dropmapEnabled,
    separateDropmaps,
    dropmapExtraLine,
    firstPenalty: penalty1Option ?? presetRecord?.firstPenalty ?? 20,
    secondPenalty: penalty2Option ?? presetRecord?.secondPenalty ?? 40,
    thirdPenaltyText:
      penalty3Option || presetRecord?.thirdPenaltyText || "Disqualification",
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
        .setName("post")
        .setDescription("Post event rules and initial banned list")
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
            .setDescription("Load a saved rules + bans preset")
            .setRequired(false)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName("event_type")
            .setDescription("Standard or special event format")
            .setRequired(false)
            .addChoices(
              { name: "Standard", value: "standard" },
              { name: "Special", value: "special" }
            )
        )
        .addStringOption(option =>
          option
            .setName("key")
            .setDescription("Unique key for later updates (optional)")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("bans")
            .setDescription("Comma or newline separated banned items")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("tier_link")
            .setDescription("Override tier restrictions URL")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("per_game_rules")
            .setDescription("Special rules per game (comma or newline separated)")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("stream_title")
            .setDescription("Stream title for this event")
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName("no_dropmap")
            .setDescription("Set true if this event does not use a dropmap")
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName("separate_dropmap")
            .setDescription("Add line saying girls/guys have separate dropmap")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("dropmap_note")
            .setDescription("Optional additional dropmap line")
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName("penalty_1")
            .setDescription("Penalty points for first offense")
            .setRequired(false)
            .setMinValue(0)
        )
        .addIntegerOption(option =>
          option
            .setName("penalty_2")
            .setDescription("Penalty points for second offense")
            .setRequired(false)
            .setMinValue(0)
        )
        .addStringOption(option =>
          option
            .setName("penalty_3")
            .setDescription("Third offense result")
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("form")
        .setDescription("Open a form to submit rules")
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
            .setDescription("Load a saved rules + bans preset")
            .setRequired(false)
            .setAutocomplete(true)
        )
        .addStringOption(option =>
          option
            .setName("event_type")
            .setDescription("Standard or special event format")
            .setRequired(false)
            .addChoices(
              { name: "Standard", value: "standard" },
              { name: "Special", value: "special" }
            )
        )
        .addStringOption(option =>
          option
            .setName("key")
            .setDescription("Unique key for later updates (optional)")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("tier_link")
            .setDescription("Override tier restrictions URL")
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName("no_dropmap")
            .setDescription("Set true if this event does not use a dropmap")
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName("separate_dropmap")
            .setDescription("Add line saying girls/guys have separate dropmap")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("dropmap_note")
            .setDescription("Optional additional dropmap line")
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName("penalty_1")
            .setDescription("Penalty points for first offense")
            .setRequired(false)
            .setMinValue(0)
        )
        .addIntegerOption(option =>
          option
            .setName("penalty_2")
            .setDescription("Penalty points for second offense")
            .setRequired(false)
            .setMinValue(0)
        )
        .addStringOption(option =>
          option
            .setName("penalty_3")
            .setDescription("Third offense result")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("stream_title")
            .setDescription("Stream title for this event")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("per_game_rules")
            .setDescription("Per-game rules (comma or newline separated)")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("save_preset")
            .setDescription("Save as preset name after posting")
            .setRequired(false)
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName("bans")
        .setDescription("Manage banned items")
        .addSubcommand(sub =>
          sub
            .setName("form")
            .setDescription("Edit banned items in a 5-line form")
            .addStringOption(option =>
              option
                .setName("key")
                .setDescription("Rules key")
                .setRequired(true)
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Add one banned item")
        .addStringOption(option =>
          option
            .setName("key")
            .setDescription("Rules key")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("item")
            .setDescription("Item to ban")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Remove one banned item")
        .addStringOption(option =>
          option
            .setName("key")
            .setDescription("Rules key")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("item")
            .setDescription("Item to remove")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("set")
        .setDescription("Replace full banned list")
        .addStringOption(option =>
          option
            .setName("key")
            .setDescription("Rules key")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("items")
            .setDescription("Comma or newline separated banned items")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("clear")
        .setDescription("Clear all banned items")
        .addStringOption(option =>
          option
            .setName("key")
            .setDescription("Rules key")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("show")
        .setDescription("Show current rules key and banned list")
        .addStringOption(option =>
          option
            .setName("key")
            .setDescription("Rules key")
            .setRequired(true)
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName("preset")
        .setDescription("Manage saved rules + bans presets")
        .addSubcommand(sub =>
          sub
            .setName("list")
            .setDescription("List saved presets")
        )
        .addSubcommand(sub =>
          sub
            .setName("show")
            .setDescription("Show a saved preset")
            .addStringOption(option =>
              option
                .setName("name")
                .setDescription("Preset name")
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName("delete")
            .setDescription("Delete a saved preset")
            .addStringOption(option =>
              option
                .setName("name")
                .setDescription("Preset name")
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async autocomplete(interaction) {
    const focusedOption = interaction.options.getFocused(true);

    try {
      if (focusedOption.name === "preset" || focusedOption.name === "name") {
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
    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    const guildId = interaction.guildId;

    if (subcommandGroup === "preset") {
      await interaction.deferReply({ ephemeral: true });

      try {
        if (subcommand === "list") {
          const presets = await listPresets(guildId);

          if (presets.length === 0) {
            return interaction.editReply({
              content:
                "No saved presets in the **Rules** sheet yet. " +
                "Use `/rules form` with **save_preset**."
            });
          }

          const lines = presets.map(preset => {
            const banCount = (preset.extraBans || []).length;
            return `- **${preset.name || preset.key}** (\`${preset.key}\`) — ${preset.mode}, ${banCount} extra ban(s)`;
          });

          return interaction.editReply({
            content: `**Saved presets (${presets.length})**\n${lines.join("\n")}`
          });
        }

        const presetKey = sanitizeKey(interaction.options.getString("name", true));
        const preset = await getPreset(guildId, presetKey);

        if (!preset) {
          return interaction.editReply({
            content: `No preset found for \`${presetKey}\` in the **Rules** sheet.`
          });
        }

        if (subcommand === "delete") {
          await deletePreset(guildId, presetKey);
          return interaction.editReply({
            content: `Deleted preset **${preset.name || presetKey}** from the **Rules** sheet.`
          });
        }

        const bansText = (preset.extraBans || []).map(item => `- ${item}`).join("\n");
        const perGameText = preset.perGameRules?.length
          ? preset.perGameRules.map(rule => `- ${rule}`).join("\n")
          : "- None";

        return interaction.editReply({
          content:
            `**Preset:** ${preset.name || preset.key}\n` +
            `**Key:** \`${preset.key}\`\n` +
            `**Mode:** ${preset.mode}\n` +
            `**Event type:** ${preset.eventType || "standard"}\n` +
            `**Stream title:** ${preset.streamTitle || "(uses event name)"}\n` +
            `**Dropmap:** ${preset.dropmapEnabled === false ? "No" : "Yes"}\n` +
            `**Separate dropmaps:** ${preset.separateDropmaps ? "Yes" : "No"}\n` +
            `**Penalties:** -${preset.firstPenalty ?? 20} / -${preset.secondPenalty ?? 40} / ${preset.thirdPenaltyText || "Disqualification"}\n` +
            `**Per-game rules:**\n${perGameText}\n` +
            `**Extra bans:**\n${bansText || "- None"}`
        });
      } catch (err) {
        console.error("[RULES PRESET]", err);
        return interaction.editReply({ content: sheetErrorMessage(err) });
      }
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
      const requestedKey = sanitizeKey(interaction.options.getString("key") || "");
      const defaultKey = deriveDefaultKey({
        scheduledEventId: resolved.scheduledEventId,
        eventName: resolved.eventName,
        mode
      });

      const token = `${interaction.user.id}-${Date.now()}`;
      const streamTitle =
        interaction.options.getString("stream_title") ||
        formConfig.streamTitle ||
        resolved.eventName;
      const perGameRules = parseRulesLines(
        interaction.options.getString("per_game_rules") ||
          formatListInput(formConfig.perGameRules)
      );
      const savePresetRaw = interaction.options.getString("save_preset") || "";

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
        requestedKey: requestedKey || defaultKey,
        scheduledEventId: resolved.scheduledEventId,
        eventName: resolved.eventName,
        eventDateTime: resolved.eventDateTime,
        streamTitle,
        perGameRules,
        savePresetRaw,
        guildId: interaction.guildId,
        channelId: interaction.channelId
      });

      return interaction.showModal(
        buildBanFormModal(
          `rules_form_submit:${token}`,
          "Banned Items",
          formConfig.extraBans
        )
      );
    }

    if (subcommandGroup === "bans" && subcommand === "form") {
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

    await interaction.deferReply({ ephemeral: true });

    if (subcommand === "post") {
      const eventId = interaction.options.getString("event", true);
      const resolved = await resolveRulesEvent(interaction, eventId);

      if (resolved.error) {
        return interaction.editReply({ content: resolved.error });
      }

      const presetInput = interaction.options.getString("preset");
      const presetKey = sanitizeKey(presetInput || "");
      let presetRecord = null;

      if (presetInput) {
        try {
          presetRecord = presetKey ? await getPreset(guildId, presetKey) : null;
        } catch (err) {
          console.error("[RULES POST PRESET]", err);
          return interaction.editReply({ content: sheetErrorMessage(err) });
        }

        if (!presetRecord) {
          return interaction.editReply({
            content: `No preset found for \`${presetKey}\` in the **Rules** sheet.`
          });
        }
      }

      const formConfig = resolveFormConfig(interaction, presetRecord);

      if (!formConfig.mode) {
        return interaction.editReply({
          content:
            "Pick a **mode**, or load a preset that includes one with `preset:`"
        });
      }

      const mode = formConfig.mode;
      const keyInput = interaction.options.getString("key");
      const key =
        sanitizeKey(keyInput) ||
        deriveDefaultKey({
          scheduledEventId: resolved.scheduledEventId,
          eventName: resolved.eventName,
          mode
        });
      const eventType = formConfig.eventType;
      const tierRestrictionsUrl = formConfig.tierRestrictionsUrl;
      const streamTitle =
        interaction.options.getString("stream_title") ||
        formConfig.streamTitle ||
        resolved.eventName;
      const perGameRules = parseRulesLines(
        interaction.options.getString("per_game_rules") ||
          formatListInput(formConfig.perGameRules)
      );
      const dropmapEnabled = formConfig.dropmapEnabled;
      const separateDropmaps = formConfig.separateDropmaps;
      const dropmapExtraLine = formConfig.dropmapExtraLine;
      const firstPenalty = formConfig.firstPenalty;
      const secondPenalty = formConfig.secondPenalty;
      const thirdPenaltyText = formConfig.thirdPenaltyText;
      const bans = normalizeBans(
        parseItemList(
          interaction.options.getString("bans") ||
            formatListInput(formConfig.extraBans)
        )
      );

      await postRulesPack(interaction, {
        key,
        scheduledEventId: resolved.scheduledEventId,
        eventName: resolved.eventName,
        eventDateTime: resolved.eventDateTime,
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
      });

      return interaction.editReply({
        content:
          `Posted rules for **${resolved.eventName}**.\n` +
          `Use key: \`${key}\`\n` +
          `Edit bans with \`/rules bans form key:${key}\``,
        components: [buildAddBanLineRow(key)]
      });
    }

    const key = sanitizeKey(interaction.options.getString("key", true));
    const eventRecord = getEvent(guildId, key);

    if (!eventRecord) {
      return interaction.editReply({
        content:
          `No rules entry found for key \`${key}\`.\n` +
          `Post one first with \`/rules form\` or \`/rules post\`.`
      });
    }

    if (subcommand === "show") {
      const effectiveBans = normalizeBans(eventRecord.bans);
      const bansText = effectiveBans.map(item => `- ${item}`).join("\n");
      const perGameText = eventRecord.perGameRules?.length
        ? eventRecord.perGameRules.map(rule => `- ${rule}`).join("\n")
        : "- None";

      return interaction.editReply({
        content:
          `**Key:** \`${key}\`\n` +
          `**Event:** ${eventRecord.eventName}\n` +
          `**Event type:** ${eventRecord.eventType || "standard"}\n` +
          `**Mode:** ${eventRecord.mode}\n` +
          `**Stream title:** ${eventRecord.streamTitle || eventRecord.eventName}\n` +
          `**Per-game rules:**\n${perGameText}\n` +
          `**Banned items:**\n${bansText}`
      });
    }

    let nextBans = normalizeBans(eventRecord.bans);

    if (subcommand === "add") {
      const item = interaction.options.getString("item", true).trim();
      if (!item) {
        return interaction.editReply({ content: "Item cannot be empty." });
      }

      const exists = nextBans.some(
        existing => existing.toLowerCase() === item.toLowerCase()
      );

      if (!exists) {
        nextBans.push(item);
      }
    }

    if (subcommand === "remove") {
      const item = interaction.options.getString("item", true);

      if (isDefaultBan(item)) {
        return interaction.editReply({
          content:
            "That item is a permanent ban for all events and cannot be removed."
        });
      }

      nextBans = removeItemCaseInsensitive(nextBans, item);
    }

    if (subcommand === "set") {
      nextBans = normalizeBans(
        parseItemList(interaction.options.getString("items", true))
      );
    }

    if (subcommand === "clear") {
      nextBans = normalizeBans([]);
    }

    try {
      nextBans = await applyBansUpdate(interaction, guildId, key, nextBans);
    } catch (err) {
      if (err.message === "missing_message") {
        return interaction.editReply({
          content:
            "I could not find the existing bans message to edit.\n" +
            "Post a fresh one with `/rules form`."
        });
      }

      throw err;
    }

    return interaction.editReply({
      content: formatBansManageReply(key, nextBans),
      components: [buildAddBanLineRow(key)]
    });
  },

  async handleButton(interaction) {
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
        `Edit bans with \`/rules bans form key:${key}\`` +
        presetSavedLine,
      components: [buildAddBanLineRow(key)]
    });

    return true;
  }
};
