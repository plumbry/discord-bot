const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const { fetchAllMessages } = require("../lib/messages");
const { isLfgCollateMessage } = require("../lib/lfgFilter");
const { getMemberTier, getMemberGender } = require("../lib/memberProfile");
const { fetchGuildScheduledEvents } = require("../lib/guildScheduledEvents");
const {
  buildSignupRolesByDay,
  formatSignupRoleSummary
} = require("../lib/lfgSignupRoles");
const {
  MESSAGE_MAX_AGE_MS,
  parseLfgMessage,
  formatEntryLine,
  buildLfgListMessage
} = require("../lib/lfgParser");

const DEFAULT_LFG_CHANNEL_ID = "1371992858084773963";
const FETCH_CAP = 500;
const DISCORD_CONTENT_LIMIT = 2000;

function splitDiscordContent(
  content,
  limit = DISCORD_CONTENT_LIMIT,
  continuedTitle = "LFG"
) {
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

function canSendToChannel(channel, clientUser) {
  const perms = channel.permissionsFor(clientUser);

  if (!perms) {
    return false;
  }

  if (channel.isThread?.()) {
    return (
      perms.has(PermissionFlagsBits.SendMessagesInThreads) ||
      perms.has(PermissionFlagsBits.SendMessages)
    );
  }

  return perms.has(PermissionFlagsBits.SendMessages);
}

async function postLfgList(channel, content, continuedTitle = "LFG") {
  const chunks = splitDiscordContent(content, DISCORD_CONTENT_LIMIT, continuedTitle);

  for (const chunk of chunks) {
    await channel.send({
      content: chunk,
      allowedMentions: { parse: [] }
    });
  }

  return chunks.length;
}

async function resolveMember(guild, userId, cache) {
  if (cache.has(userId)) {
    return cache.get(userId);
  }

  let member = guild.members.cache.get(userId);

  if (!member) {
    member = await guild.members.fetch(userId).catch(() => null);
  }

  cache.set(userId, member);
  return member;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("lfg")
    .setDescription(
      "Collate LFG posts for today, tomorrow, and the day after"
    )
    .addBooleanOption(option =>
      option
        .setName("post")
        .setDescription(
          "Post the list in this channel (default yes)"
        )
        .setRequired(false)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageRoles
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const channel = interaction.channel;
    const messageCutoff = Date.now() - MESSAGE_MAX_AGE_MS;
    const referenceNow = new Date();

    const shouldPost =
      interaction.options.getBoolean("post") ?? true;

    if (!channel?.isTextBased?.()) {
      return interaction.editReply({
        content: "Run this command in a text channel."
      });
    }

    if (
      channel.id !== DEFAULT_LFG_CHANNEL_ID &&
      !channel.name.toLowerCase().includes("lfg")
    ) {
      await interaction.editReply({
        content:
          `Scanning **${channel}** (not the main LFG channel). ` +
          `Main LFG: <#${DEFAULT_LFG_CHANNEL_ID}>`
      });
    }

    const scheduledEvents = await fetchGuildScheduledEvents(guild);

    if (guild.roles.cache.size <= 1) {
      await guild.roles.fetch().catch(() => {});
    }

    const signupRolesByDay = buildSignupRolesByDay(
      guild,
      scheduledEvents,
      referenceNow
    );
    const messages = await fetchAllMessages(channel, {
      maxMessages: FETCH_CAP
    });

    const memberCache = new Map();
    /** @type {Map<string, { message: import("discord.js").Message, parsed: object }>} */
    const latestByAuthor = new Map();

    for (const message of messages) {
      if (message.author.bot) {
        continue;
      }

      if (message.createdTimestamp < messageCutoff) {
        continue;
      }

      const text = message.content?.trim();

      if (!text || !isLfgCollateMessage(message)) {
        continue;
      }

      const parsed = parseLfgMessage(
        text,
        scheduledEvents,
        new Date(message.createdTimestamp),
        referenceNow
      );

      if (!parsed) {
        continue;
      }

      if (!parsed.fillOffer) {
        const daySignup = signupRolesByDay.get(parsed.whenSortKey);

        if (daySignup) {
          const member = await resolveMember(
            guild,
            message.author.id,
            memberCache
          );

          if (member?.roles.cache.has(daySignup.role.id)) {
            continue;
          }
        }
      }

      const existing = latestByAuthor.get(message.author.id);

      if (
        !existing ||
        message.createdTimestamp > existing.message.createdTimestamp
      ) {
        latestByAuthor.set(message.author.id, { message, parsed });
      }
    }

    const entries = [];

    for (const { message, parsed } of latestByAuthor.values()) {
      let tier = null;
      let gender = null;

      if (parsed.fillOffer) {
        const member = await resolveMember(
          guild,
          message.author.id,
          memberCache
        );
        tier = member ? getMemberTier(member) : null;
        gender = member ? getMemberGender(member) : null;
      }

      entries.push({
        whenLabel: parsed.whenLabel,
        whenSortKey: parsed.whenSortKey,
        fillOffer: parsed.fillOffer,
        line: formatEntryLine({
          username: message.author.username,
          tier,
          gender,
          fillOffer: parsed.fillOffer,
          slotsNeeded: parsed.slotsNeeded,
          tierNeed: parsed.tierNeed,
          genderNeed: parsed.genderNeed
        })
      });
    }

    if (entries.length === 0) {
      return interaction.editReply({
        content:
          "No LFG posts for **today/tomorrow/day-after** in the last 72 hours.\n\n" +
          "Only top-level recruiting/fill posts are included (need 1, n1, can fill, etc.)."
      });
    }

    const listContent = buildLfgListMessage(entries);
    const continuedTitle = "LFG";
    let postCount = 0;

    if (shouldPost) {
      if (!canSendToChannel(channel, interaction.client.user)) {
        return interaction.editReply({
          content:
            "Built the list but the bot cannot **Send Messages** in this channel."
        });
      }

      try {
        postCount = await postLfgList(channel, listContent, continuedTitle);
      } catch (err) {
        console.error("[LFG] post failed:", err);

        const detail =
          err?.code != null
            ? `Discord error \`${err.code}\`: ${err.message}`
            : err?.message ?? String(err);

        return interaction.editReply({
          content:
            "Built the list but could not post it.\n\n" +
            `${detail}\n\n` +
            (listContent.length > DISCORD_CONTENT_LIMIT
              ? `List is **${listContent.length}** characters (limit ${DISCORD_CONTENT_LIMIT}); split should have applied — report if this persists.`
              : "Common causes: invalid markdown in a post, or missing **Send Messages** / **Send Messages in Threads**.")
        });
      }
    }

    const preview =
      listContent.length > 1800
        ? listContent.slice(0, 1800) + "\n…"
        : listContent;

    return interaction.editReply({
      content:
        `Found **${entries.length}** LFG post(s) for today/tomorrow/day-after (last 72 hours).\n` +
        `${formatSignupRoleSummary(signupRolesByDay)}\n` +
        (shouldPost
          ? ` Posted ${postCount} message(s) in ${channel}.`
          : " List was not posted (`post: No`).") +
        `\n\n${preview}`
    });
  }
};
