const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { forEachGuildMemberPage } = require("../lib/guildMemberList");

const MESSAGE_LIMIT = 1900;

function splitDiscordMessages(text, limit = MESSAGE_LIMIT) {
  if (text.length <= limit) {
    return [text];
  }

  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    const next = current ? `${current}\n${line}` : line;

    if (next.length > limit) {
      if (current) {
        chunks.push(current);
      }

      if (line.length > limit) {
        chunks.push(line.slice(0, limit));
        current = line.slice(limit);
      } else {
        current = line;
      }
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function isMemberInVoice(member, guild) {
  const voiceState = member.voice ?? guild.voiceStates.cache.get(member.id);
  return Boolean(voiceState?.channelId);
}

function buildReport(role, inVoice, notInVoice) {
  const checked = inVoice.length + notInVoice.length;
  const lines = [
    "🎙️ **Voice Check**",
    `Role: ${role}`,
    "",
    `Checked: **${checked}** | In voice: **${inVoice.length}** | Not in voice: **${notInVoice.length}**`
  ];

  if (checked === 0) {
    lines.push("", "ℹ️ No non-bot members have this role.");
    return lines.join("\n");
  }

  if (notInVoice.length === 0) {
    lines.push("", `✅ Everyone with ${role} is currently in voice.`);
    return lines.join("\n");
  }

  lines.push("", `❌ **Not in voice (${notInVoice.length}):**`, "");

  for (const member of notInVoice) {
    lines.push(`• <@${member.id}>`);
  }

  return lines.join("\n");
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("voicecheck")
    .setDescription(
      "Check whether all non-bot members with a role are in a voice channel"
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Role to check for voice presence")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const role = interaction.options.getRole("role");
    const guild = interaction.guild;

    const inVoice = [];
    const notInVoice = [];

    await forEachGuildMemberPage(guild, async batch => {
      for (const member of batch.values()) {
        if (member.user.bot) {
          continue;
        }

        if (!member.roles.cache.has(role.id)) {
          continue;
        }

        if (isMemberInVoice(member, guild)) {
          inVoice.push(member);
        } else {
          notInVoice.push(member);
        }
      }
    });

    const report = buildReport(role, inVoice, notInVoice);
    const chunks = splitDiscordMessages(report);

    await interaction.editReply({ content: chunks[0] });

    for (let index = 1; index < chunks.length; index++) {
      await interaction.followUp({ content: chunks[index] });
    }
  }
};
