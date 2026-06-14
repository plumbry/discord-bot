const crypto = require("crypto");
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require("discord.js");

const SAY_PREFIX = "say:";
const PENDING_TTL_MS = 5 * 60 * 1000;
const pendingSay = new Map();

const TEXT_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread
]);

function parseMemberIds(input) {
  if (!input?.trim()) {
    return [];
  }

  const ids = new Set();

  for (const match of input.matchAll(/<@!?(\d{17,20})>/g)) {
    ids.add(match[1]);
  }

  for (const token of input.split(/\s+/)) {
    if (/^\d{17,20}$/.test(token)) {
      ids.add(token);
    }
  }

  return [...ids];
}

function buildSayContent(message, memberIds) {
  const parts = [];

  if (message?.trim()) {
    parts.push(message.trim());
  }

  if (memberIds.length) {
    parts.push(memberIds.map(id => `<@${id}>`).join(" "));
  }

  return parts.join("\n\n");
}

function buildAllowedMentions(memberIds) {
  if (!memberIds.length) {
    return { parse: [] };
  }

  return { users: memberIds };
}

function resolveTargetChannel(interaction) {
  return (
    interaction.options?.getChannel("channel") ||
    interaction.channel
  );
}

function canPostInChannel(channel) {
  if (!channel?.isTextBased?.()) {
    return { ok: false, error: "❌ That channel cannot receive messages." };
  }

  const me = channel.guild?.members?.me;
  const perms = me ? channel.permissionsFor(me) : null;

  if (perms && !perms.has(PermissionFlagsBits.SendMessages)) {
    return {
      ok: false,
      error: `❌ I don't have **Send Messages** permission in <#${channel.id}>.`
    };
  }

  return { ok: true, channel };
}

function storePendingMemberIds(channelId, memberIds) {
  const token = crypto.randomUUID().slice(0, 8);

  pendingSay.set(token, {
    channelId,
    memberIds,
    expiresAt: Date.now() + PENDING_TTL_MS
  });

  return token;
}

function takePendingMemberIds(token, channelId) {
  const entry = pendingSay.get(token);

  pendingSay.delete(token);

  if (!entry || entry.expiresAt < Date.now()) {
    return [];
  }

  if (entry.channelId !== channelId) {
    return [];
  }

  return entry.memberIds;
}

async function postSayMessage(channel, { message, memberIds }) {
  const content = buildSayContent(message, memberIds);

  if (!content) {
    throw new Error("EMPTY_SAY");
  }

  return channel.send({
    content,
    allowedMentions: buildAllowedMentions(memberIds)
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("say")
    .setDescription("Post a message as the bot (confirmation is only visible to you)")
    .addChannelOption(o =>
      o
        .setName("channel")
        .setDescription("Channel to post in (defaults to this channel)")
        .addChannelTypes(...TEXT_CHANNEL_TYPES)
        .setRequired(false)
    )
    .addStringOption(o =>
      o
        .setName("members")
        .setDescription("Members to ping (@mentions or IDs, space-separated)")
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o
        .setName("tag_only")
        .setDescription("Only ping members — no message text")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    const check = canPostInChannel(resolveTargetChannel(interaction));

    if (!check.ok) {
      return interaction.reply({
        content: check.error,
        ephemeral: true
      });
    }

    const membersRaw = interaction.options.getString("members");
    const tagOnly = interaction.options.getBoolean("tag_only") ?? false;
    const memberIds = parseMemberIds(membersRaw);

    if (tagOnly) {
      if (!memberIds.length) {
        return interaction.reply({
          content:
            "❌ **tag_only** requires **members** (@mentions or user IDs).",
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const sent = await postSayMessage(check.channel, {
          message: "",
          memberIds
        });

        return interaction.editReply({
          content:
            `✅ Tagged ${memberIds.length} member(s) in <#${check.channel.id}>.\n` +
            `${sent.url}`
        });
      } catch (err) {
        console.error("[SAY]", err);

        return interaction.editReply({
          content: "❌ Failed to tag members."
        });
      }
    }

    const token = memberIds.length
      ? storePendingMemberIds(check.channel.id, memberIds)
      : "";

    const modal = new ModalBuilder()
      .setCustomId(
        token
          ? `${SAY_PREFIX}${check.channel.id}:${token}`
          : `${SAY_PREFIX}${check.channel.id}`
      )
      .setTitle("Post as Helper Bot")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("message")
            .setLabel("Message")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000)
            .setPlaceholder(
              "Write your full message here — line breaks are supported."
            )
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("members")
            .setLabel("Members to ping (optional)")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(500)
            .setPlaceholder("@user IDs or @mentions — one per line or space-separated")
            .setValue(membersRaw || "")
        )
      );

    return interaction.showModal(modal);
  },

  async handleModalSubmit(interaction) {
    if (!interaction.customId.startsWith(SAY_PREFIX)) {
      return false;
    }

    const payload = interaction.customId.slice(SAY_PREFIX.length);
    const [channelId, token = ""] = payload.split(":");

    const message = interaction.fields.getTextInputValue("message");
    const membersField = interaction.fields.getTextInputValue("members");
    const cachedIds = token ? takePendingMemberIds(token, channelId) : [];
    const memberIds = [
      ...new Set([
        ...cachedIds,
        ...parseMemberIds(membersField)
      ])
    ];

    if (!message.trim() && !memberIds.length) {
      await interaction.reply({
        content: "❌ Provide a message and/or members to ping.",
        ephemeral: true
      });
      return true;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const channel = await interaction.client.channels.fetch(channelId);
      const check = canPostInChannel(channel);

      if (!check.ok) {
        return interaction.editReply({ content: check.error });
      }

      const sent = await postSayMessage(check.channel, {
        message,
        memberIds
      });

      const tagNote = memberIds.length
        ? ` Tagged ${memberIds.length} member(s).`
        : "";

      return interaction.editReply({
        content: `✅ Posted in <#${channelId}>.${tagNote}\n${sent.url}`
      });
    } catch (err) {
      console.error("[SAY]", err);

      return interaction.editReply({
        content: "❌ Failed to post that message."
      });
    }
  }
};
