const { SlashCommandBuilder } = require("discord.js");
const {
  sheetsConfigured,
  allocateReference,
  releaseReference,
  appendAnonqEntry
} = require("../lib/anonqSheet");

const MENTEE_ROLE_ID = process.env.MENTEE_ROLE_ID || "1473993603062960210";
const MENTORING_CHANNEL_ID =
  process.env.MENTORING_CHANNEL_ID || "1473992977725784065";
const LOG_CHANNEL_ID =
  process.env.BOT_STATUS_CHANNEL_ID || "1471082166535454780";

const COOLDOWN_MS = Number(process.env.ANONQ_COOLDOWN_MS || 2 * 60 * 1000);
const QUESTION_MAX_LENGTH = 1500;

const cooldowns = new Map();

function ephemeralReply(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content });
  }

  return interaction.reply({ content, ephemeral: true });
}

function formatRemaining(ms) {
  const totalSec = Math.max(1, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;

  if (minutes <= 0) {
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  if (seconds === 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${minutes} minute${minutes === 1 ? "" : "s"} ${seconds} second${
    seconds === 1 ? "" : "s"
  }`;
}

function getCooldownRemaining(userId) {
  const lastAt = cooldowns.get(userId);

  if (!lastAt) {
    return 0;
  }

  const remaining = lastAt + COOLDOWN_MS - Date.now();
  return remaining > 0 ? remaining : 0;
}

function staffUsername(interaction) {
  const username = interaction.user.username || interaction.user.tag;
  const displayName =
    interaction.member?.displayName ||
    interaction.user.globalName ||
    username;

  if (displayName && displayName !== username) {
    return `${displayName} (@${username})`;
  }

  return username;
}

function formatPublicQuestion(reference, question) {
  const quoted = question
    .split(/\r?\n/)
    .map(line => `> ${line}`)
    .join("\n");

  return `### Anonymous Mentee Question\n\n\`${reference}\`\n\n${quoted}`;
}

async function logAuditFailure({ client, reference, userId, messageId, deleted, err }) {
  console.error("[ANONQ] audit log failed:", {
    reference,
    userId,
    messageId,
    deleted,
    err: err?.stack || err?.message || err
  });

  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);

    if (!channel?.isTextBased?.()) {
      return;
    }

    const deletedText = deleted ? "Public message deleted." : "Public message could not be deleted.";

    await channel.send(
      `⚠️ \`/anonq\` audit log failed for \`${reference}\`.\n` +
        `Submitter: <@${userId}> (\`${userId}\`)\n` +
        `${deletedText} Check hosting logs if the sheet entry is missing.`
    );
  } catch (logErr) {
    console.error("[ANONQ] failed posting audit-failure notice:", logErr?.message || logErr);
  }
}

async function resolveMember(interaction) {
  if (interaction.member?.roles?.cache) {
    return interaction.member;
  }

  if (!interaction.guild) {
    return null;
  }

  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("anonq")
    .setDescription("Post an anonymous mentoring question")
    .addStringOption(option =>
      option
        .setName("question")
        .setDescription("Your question (posted anonymously in Mentoring)")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(QUESTION_MAX_LENGTH)
    ),

  async execute(interaction) {
    const member = await resolveMember(interaction);

    if (!member?.roles?.cache?.has(MENTEE_ROLE_ID)) {
      return ephemeralReply(
        interaction,
        "You need the Mentee role to use /anonq."
      );
    }

    if (interaction.channelId !== MENTORING_CHANNEL_ID) {
      return ephemeralReply(
        interaction,
        `Please use /anonq in the Mentoring channel: <#${MENTORING_CHANNEL_ID}>.`
      );
    }

    const question = (interaction.options.getString("question", true) || "").trim();

    if (!question) {
      return ephemeralReply(
        interaction,
        "Please enter a question. Empty or whitespace-only submissions are not allowed."
      );
    }

    const remaining = getCooldownRemaining(interaction.user.id);

    if (remaining > 0) {
      return ephemeralReply(
        interaction,
        `You can use /anonq again in ${formatRemaining(remaining)}.`
      );
    }

    if (!sheetsConfigured()) {
      return ephemeralReply(
        interaction,
        "Anonymous questions are temporarily unavailable. Please try again later."
      );
    }

    await interaction.deferReply({ ephemeral: true });

    let reference;

    try {
      reference = await allocateReference();
    } catch (err) {
      console.error("[ANONQ] failed to allocate reference:", err);
      return ephemeralReply(
        interaction,
        "Anonymous questions are temporarily unavailable. Please try again later."
      );
    }

    let posted;

    try {
      const channel =
        interaction.channel?.isTextBased?.()
          ? interaction.channel
          : await interaction.client.channels.fetch(MENTORING_CHANNEL_ID);

      posted = await channel.send({
        content: formatPublicQuestion(reference, question),
        allowedMentions: { parse: [] }
      });
    } catch (err) {
      releaseReference(reference);
      console.error("[ANONQ] failed to post question:", err);
      return ephemeralReply(
        interaction,
        "Failed to post your question. Please try again."
      );
    }

    try {
      await appendAnonqEntry({
        reference,
        userId: interaction.user.id,
        username: staffUsername(interaction),
        question,
        messageId: posted.id,
        channelId: posted.channelId || MENTORING_CHANNEL_ID,
        guildId: interaction.guildId || ""
      });
    } catch (err) {
      let deleted = false;

      try {
        await posted.delete();
        deleted = true;
      } catch (deleteErr) {
        console.error("[ANONQ] failed to delete unlogged question:", deleteErr);
      }

      await logAuditFailure({
        client: interaction.client,
        reference,
        userId: interaction.user.id,
        messageId: posted.id,
        deleted,
        err
      });

      return ephemeralReply(
        interaction,
        "Your question could not be recorded, so it was not posted. Please try again."
      );
    }

    cooldowns.set(interaction.user.id, Date.now());

    return ephemeralReply(
      interaction,
      "Your anonymous question has been posted."
    );
  }
};
