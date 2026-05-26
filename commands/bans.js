const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require("discord.js");
const {
  getPreset,
  listPresets,
  formatPresetNotFoundMessage
} = require("../lib/rulesSheet");
const {
  listSuggestions,
  buildSuggestionSelectRow,
  filterSuggestionsNotInList,
  TYPES
} = require("../lib/rulesSuggestionsSheet");
const {
  sanitizeKey,
  deriveBansOnlyKey,
  appendUniqueStrings,
  saveTypedSuggestionsToLibrary,
  resolveBansTargetInChannel,
  applyBansUpdate,
  parseBansModalInput,
  buildBansFromExtraLines,
  formatBansEmbedValue,
  formatBansPanelDescription,
  buildBanFormModal,
  showPendingAddBanModal,
  showBansFormModal,
  showAddBanLineModal,
  buildBanEditEmbed,
  buildEphemeralBanEditRow,
  postBansOnlyPack,
  getPendingExtraBans,
  getEvent,
  setEvent,
  editBanPickCache,
  assertCanPostBansOnlyPack,
  acknowledgeSelectSilently,
  acknowledgeModalSilently,
  acknowledgeButtonSilently,
  replyModalError,
  buildBansEditorFooterNotes,
  bansMessageDeletedUserMessage
} = require("../lib/eventBansShared");
const { extraBansOnly, normalizeBans } = require("../lib/rulesTemplate");

const PREFIX = "bans";
const pendingBansForms = new Map();
const ephemeralBanEditCache = new Map();
const DEFAULT_BANS_TITLE = "Banned items";

function buildBansSetupEmbed(context) {
  const extraBans = getPendingExtraBans(context);
  const embed = new EmbedBuilder()
    .setTitle(`Banned items — ${context.eventName}`)
    .setDescription(
      formatBansPanelDescription(
        "Set extras below, then click **Post bans**."
      )
    )
    .setColor(0xed4245)
    .addFields({
      name: "Extra bans",
      value: formatBansEmbedValue(extraBans),
      inline: false
    });

  if (context.eventDateTime) {
    embed.addFields({ name: "When", value: context.eventDateTime, inline: true });
  }

  return embed;
}

async function buildBansSetupComponents(token, context, guildId) {
  const rows = [];

  try {
    const savedBans = filterSuggestionsNotInList(
      await listSuggestions(guildId, TYPES.BAN),
      getPendingExtraBans(context)
    );
    context.savedBanOptions = savedBans;

    const banPick = buildSuggestionSelectRow({
      customId: `${PREFIX}_saved_ban:${token}`,
      placeholder: "Recents…",
      items: savedBans
    });

    if (banPick) {
      rows.push(banPick.row);
    }
  } catch (err) {
    console.error("[BANS LIBRARY] load suggestions:", err?.message || err);
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PREFIX}_setup_bans:${token}`)
        .setLabel("Edit ban list")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}_setup_add_ban:${token}`)
        .setLabel("+ Add one")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}_post:${token}`)
        .setLabel("Post bans")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${PREFIX}_cancel:${token}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return rows.slice(0, 5);
}

async function refreshBansSetupEphemeral(interaction, context) {
  await interaction.update({
    embeds: [buildBansSetupEmbed(context)],
    components: await buildBansSetupComponents(
      context.token,
      context,
      context.guildId
    )
  });
}

function buildBansPostedEmbed(eventName) {
  return new EmbedBuilder()
    .setTitle(`Posted — ${eventName}`)
    .setDescription(
      "Banned items are in this channel.\n" +
        "Use `/bans edit` here to change the list."
    )
    .setColor(0x57f287);
}

function sheetErrorMessage(err) {
  if (err?.message?.includes("MAIN_SHEET_ID")) {
    return "MAIN_SHEET_ID is not configured — cannot use the **Rules** sheet.";
  }

  return (
    "Could not access the **Rules** sheet. " +
    "Check the tab exists and the bot has sheet access."
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

async function openBansEditor(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const resolved = await resolveBansTargetInChannel(interaction);

  if (!resolved) {
    await interaction.editReply({
      content:
        "No banned-items message found in this channel.\n\n" +
        "Post one with `/bans post` or `/rules form` first."
    });
    return;
  }

  if (resolved.bansMessageDeleted) {
    await interaction.editReply({
      content: bansMessageDeletedUserMessage(resolved.eventRecord.eventName)
    });
    return;
  }

  const { key, eventRecord, multipleInChannel, recoveredFromMessage } = resolved;

  if (recoveredFromMessage) {
    setEvent(interaction.guildId, key, eventRecord);
  }

  const token = `${interaction.user.id}-${Date.now()}`;

  ephemeralBanEditCache.set(token, {
    key,
    guildId: interaction.guildId,
    userId: interaction.user.id
  });

  const footerNote = buildBansEditorFooterNotes({
    multipleInChannel,
    recoveredFromMessage
  });

  await interaction.editReply({
    embeds: [buildBanEditEmbed(eventRecord, { footerNote })],
    components: [buildEphemeralBanEditRow(PREFIX, token)]
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("bans")
    .setDescription("Post or edit a bans-only message (no rules text)")
    .addSubcommand(sub =>
      sub
        .setName("post")
        .setDescription("Post a banned-items message in this channel")
        .addStringOption(option =>
          option
            .setName("title")
            .setDescription("Optional label on the setup panel")
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName("preset")
            .setDescription("Load extra bans from a Rules sheet preset")
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("edit")
        .setDescription(
          "Edit the ban list where bans were posted (this channel)"
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
      const presets = await listPresets(interaction.guildId);
      const choices = buildPresetChoices(presets, focusedValue);
      return await interaction.respond(choices);
    } catch (err) {
      console.error("[BANS AUTOCOMPLETE]", err);

      if (interaction.responded) {
        return;
      }

      return interaction.respond([]).catch(() => {});
    }
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "edit") {
      return openBansEditor(interaction);
    }

    const channelId = interaction.channelId;
    const titleInput = interaction.options.getString("title")?.trim();
    const eventName = titleInput || DEFAULT_BANS_TITLE;

    await interaction.deferReply({ ephemeral: true });

    try {
      await assertCanPostBansOnlyPack(interaction.guildId, {
        eventName,
        channelId
      });
    } catch (err) {
      if (err.message === "bans_already_posted" && err.userMessage) {
        return interaction.editReply({
          content: err.userMessage
        });
      }

      throw err;
    }

    const presetInput = interaction.options.getString("preset");
    const presetKey = sanitizeKey(presetInput || "");
    let extraBans = [];

    if (presetInput) {
      try {
        const presetRecord = presetKey
          ? await getPreset(interaction.guildId, presetKey)
          : null;

        if (!presetRecord) {
          return interaction.editReply({
            content: formatPresetNotFoundMessage(
              presetKey || presetInput,
              interaction.guildId
            )
          });
        }

        extraBans = presetRecord.extraBans || [];

        if (extraBans.length) {
          saveTypedSuggestionsToLibrary(interaction.guildId, { bans: extraBans });
        }
      } catch (err) {
        console.error("[BANS POST PRESET]", err);
        return interaction.editReply({
          content: sheetErrorMessage(err)
        });
      }
    }

    const token = `${interaction.user.id}-${Date.now()}`;
    const requestedKey = deriveBansOnlyKey({ channelId });

    const context = {
      token,
      guildId: interaction.guildId,
      channelId,
      scheduledEventId: "",
      eventName,
      eventDateTime: null,
      requestedKey,
      pendingBans: extraBans,
      extraBans
    };

    pendingBansForms.set(token, context);

    return interaction.editReply({
      embeds: [buildBansSetupEmbed(context)],
      components: await buildBansSetupComponents(token, context, interaction.guildId)
    });
  },

  async handleSelectMenu(interaction) {
    if (interaction.customId.startsWith(`${PREFIX}_saved_ban_edit:`)) {
      const key = sanitizeKey(interaction.customId.split(":")[1]);
      const index = Number(interaction.values[0]);
      const options = editBanPickCache.get(`${PREFIX}:${key}`) || [];
      const item = options[index];

      if (!item) {
        await interaction.reply({
          content: "That saved item is no longer available.",
          ephemeral: true
        });
        return true;
      }

      await acknowledgeSelectSilently(interaction);

      try {
        const eventRecord = getEvent(interaction.guildId, key);

        if (!eventRecord) {
          return interaction.followUp({
            content: "No ban pack found for this channel.",
            ephemeral: true
          });
        }

        const nextBans = normalizeBans([...extraBansOnly(eventRecord.bans), item]);
        await applyBansUpdate(interaction, interaction.guildId, key, nextBans);
        saveTypedSuggestionsToLibrary(interaction.guildId, { bans: [item] });
      } catch (err) {
        console.error("[BANS SAVED EDIT]", err);
        return interaction.followUp({
          content: "Failed to add that banned item.",
          ephemeral: true
        });
      }

      return true;
    }

    if (!interaction.customId.startsWith(`${PREFIX}_saved_ban:`)) {
      return false;
    }

    const token = interaction.customId.split(":")[1];
    const context = pendingBansForms.get(token);
    const index = Number(interaction.values[0]);
    const item = context?.savedBanOptions?.[index];

    if (!context || !item) {
      await interaction.reply({
        content: "This setup expired. Run `/bans post` again.",
        ephemeral: true
      });
      return true;
    }

    const pendingBans = appendUniqueStrings(getPendingExtraBans(context), [item]);
    const nextContext = { ...context, pendingBans };

    pendingBansForms.set(token, nextContext);
    saveTypedSuggestionsToLibrary(context.guildId, { bans: [item] });
    await refreshBansSetupEphemeral(interaction, nextContext);

    return true;
  },

  async handleButton(interaction) {
    if (interaction.customId.startsWith(`${PREFIX}_cancel:`)) {
      const token = interaction.customId.split(":")[1];

      pendingBansForms.delete(token);

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

    if (interaction.customId.startsWith(`${PREFIX}_dismiss:`)) {
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("Dismissed")
            .setColor(0x99aab5)
        ],
        components: []
      });

      return true;
    }

    if (interaction.customId.startsWith(`${PREFIX}_edit_ephemeral:`)) {
      const token = interaction.customId.split(":")[1];
      const cached = ephemeralBanEditCache.get(token);

      if (
        !cached ||
        cached.userId !== interaction.user.id ||
        cached.guildId !== interaction.guildId
      ) {
        await interaction.reply({
          content: "This edit session expired. Run `/bans edit` again.",
          ephemeral: true
        });
        return true;
      }

      const eventRecord = getEvent(cached.guildId, cached.key);

      if (!eventRecord) {
        ephemeralBanEditCache.delete(token);
        await interaction.reply({
          content: "No ban pack found. Run `/bans edit` again.",
          ephemeral: true
        });
        return true;
      }

      await showBansFormModal(
        interaction,
        PREFIX,
        cached.key,
        extraBansOnly(eventRecord.bans)
      );

      return true;
    }

    if (interaction.customId.startsWith(`${PREFIX}_setup_bans:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingBansForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/bans post` again.",
          ephemeral: true
        });
        return true;
      }

      await interaction.showModal(
        buildBanFormModal(
          `${PREFIX}_form_submit:${token}`,
          "Ban list",
          getPendingExtraBans(context)
        )
      );

      return true;
    }

    if (interaction.customId.startsWith(`${PREFIX}_setup_add_ban:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingBansForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/bans post` again.",
          ephemeral: true
        });
        return true;
      }

      await showPendingAddBanModal(interaction, PREFIX, token);
      return true;
    }

    if (interaction.customId.startsWith(`${PREFIX}_edit_bans:`)) {
      const key = sanitizeKey(interaction.customId.split(":")[1]);
      const eventRecord = getEvent(interaction.guildId, key);

      if (!eventRecord) {
        await interaction.reply({
          content: "No ban pack found for this channel.",
          ephemeral: true
        });
        return true;
      }

      await showBansFormModal(
        interaction,
        PREFIX,
        key,
        extraBansOnly(eventRecord.bans)
      );

      return true;
    }

    if (interaction.customId.startsWith(`${PREFIX}_post:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingBansForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/bans post` again.",
          ephemeral: true
        });
        return true;
      }

      try {
        await assertCanPostBansOnlyPack(interaction.guildId, {
          eventName: context.eventName,
          channelId: context.channelId
        });
      } catch (err) {
        if (err.message === "bans_already_posted" && err.userMessage) {
          return interaction.followUp({
            content: err.userMessage,
            ephemeral: true
          });
        }

        throw err;
      }

      const key = context.requestedKey;
      const bans = normalizeBans(getPendingExtraBans(context));

      try {
        await postBansOnlyPack(interaction, {
          key,
          scheduledEventId: context.scheduledEventId,
          eventName: context.eventName,
          eventDateTime: context.eventDateTime,
          bans
        });
      } catch (err) {
        if (err.message === "bans_already_posted" && err.userMessage) {
          return interaction.followUp({
            content: err.userMessage,
            ephemeral: true
          });
        }

        console.error("[BANS POST]", err);

        return interaction.followUp({
          content: "Failed to post banned items. Try again.",
          ephemeral: true
        });
      }

      pendingBansForms.delete(token);

      await interaction.update({
        embeds: [buildBansPostedEmbed(context.eventName)],
        components: []
      });

      return true;
    }

    if (!interaction.customId.startsWith(`${PREFIX}_add_ban:`)) {
      return false;
    }

    const key = sanitizeKey(interaction.customId.split(":")[1]);
    const eventRecord = getEvent(interaction.guildId, key);

    if (!eventRecord) {
      await interaction.reply({
        content: "No ban pack found for this channel.",
        ephemeral: true
      });
      return true;
    }

    await showAddBanLineModal(interaction, PREFIX, key);
    return true;
  },

  async handleModalSubmit(interaction) {
    if (interaction.customId.startsWith(`${PREFIX}_form_submit:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingBansForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/bans post` again.",
          ephemeral: true
        });
        return true;
      }

      const parsed = parseBansModalInput(interaction.fields);

      const nextContext = {
        ...context,
        pendingBans: parsed.lines
      };

      pendingBansForms.set(token, nextContext);
      saveTypedSuggestionsToLibrary(context.guildId, { bans: parsed.lines });
      await refreshBansSetupEphemeral(interaction, nextContext);

      return true;
    }

    if (interaction.customId.startsWith(`${PREFIX}_pending_add_ban:`)) {
      const token = interaction.customId.split(":")[1];
      const context = pendingBansForms.get(token);

      if (!context) {
        await interaction.reply({
          content: "This setup expired. Run `/bans post` again.",
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

      const pendingBans = appendUniqueStrings(getPendingExtraBans(context), [item]);
      const nextContext = { ...context, pendingBans };

      pendingBansForms.set(token, nextContext);
      saveTypedSuggestionsToLibrary(context.guildId, { bans: [item] });
      await refreshBansSetupEphemeral(interaction, nextContext);

      return true;
    }

    if (interaction.customId.startsWith(`${PREFIX}_add_ban:`)) {
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

      const eventRecord = getEvent(interaction.guildId, key);

      try {
        if (!eventRecord) {
          return replyModalError(
            interaction,
            "No ban pack found for this channel."
          );
        }

        const nextBans = normalizeBans([...extraBansOnly(eventRecord.bans), item]);
        await applyBansUpdate(interaction, interaction.guildId, key, nextBans);
        saveTypedSuggestionsToLibrary(interaction.guildId, { bans: [item] });
        await acknowledgeModalSilently(interaction);
      } catch (err) {
        console.error("[BANS ADD BAN]", err);

        if (err.message === "bans_message_deleted") {
          return replyModalError(
            interaction,
            bansMessageDeletedUserMessage(eventRecord?.eventName)
          );
        }

        return replyModalError(interaction, "Failed to add banned item.");
      }

      return true;
    }

    if (!interaction.customId.startsWith(`${PREFIX}_bans_form:`)) {
      return false;
    }

    const key = sanitizeKey(interaction.customId.split(":")[1]);
    const parsed = parseBansModalInput(interaction.fields);

    await interaction.deferReply({ ephemeral: true });

    try {
      const eventRecord = getEvent(interaction.guildId, key);

      if (!eventRecord) {
        return replyModalError(
          interaction,
          "No ban pack found for this channel."
        );
      }

      const nextBans = buildBansFromExtraLines(parsed.lines);
      await applyBansUpdate(interaction, interaction.guildId, key, nextBans);
      saveTypedSuggestionsToLibrary(interaction.guildId, {
        bans: extraBansOnly(nextBans)
      });
      await acknowledgeModalSilently(interaction);
    } catch (err) {
      console.error("[BANS FORM]", err);

      if (err.message === "bans_message_deleted") {
        return replyModalError(
          interaction,
          bansMessageDeletedUserMessage(eventRecord.eventName)
        );
      }

      return replyModalError(interaction, "Failed to update banned items.");
    }

    return true;
  }
};
