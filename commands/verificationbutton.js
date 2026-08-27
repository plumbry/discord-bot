const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const { userIsStaff } = require("../lib/staffPermissions");
const { getMemberTier } = require("../lib/memberProfile");

const BUTTON_CUSTOM_ID = "verificationbutton:im_verified";

const YUNITE_VERIFIED_ROLE_ID =
  process.env.YUNITE_VERIFIED_ROLE_ID || "1371623256855154818";

const YUNITE_VERIFY_CHANNEL_ID =
  process.env.YUNITE_VERIFY_CHANNEL_ID || "1371647079935377418";

const MEMBER_ROLE_ID =
  process.env.MEMBER_ROLE_ID || process.env.SERVER_ACCESS_ROLE_ID || "";

/** @type {Set<string>} */
const notifiedMembers = new Set();

function parseIdList(raw) {
  return String(raw || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function onboardingAdminIds() {
  return parseIdList(process.env.ONBOARDING_ADMIN_USER_IDS);
}

function memberRoleIds() {
  return parseIdList(MEMBER_ROLE_ID);
}

function notifyKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function hasServerAccess(member) {
  return memberRoleIds().some(roleId => member.roles.cache.has(roleId));
}

function memberDisplayName(member, user) {
  return member?.displayName || user.globalName || user.username;
}

function buildAdminDm(member, user) {
  const displayName = memberDisplayName(member, user);
  const tier = getMemberTier(member);
  const profileUrl = `https://discord.com/users/${user.id}`;

  return (
    `🔔 ${displayName} is Yunite verified and waiting for access.\n\n` +
    `Display name: ${displayName}\n` +
    `Username: @${user.username}\n` +
    `User ID: ${user.id}\n` +
    `Member: <@${user.id}>\n` +
    `Profile: ${profileUrl}\n` +
    `Current ZBD tier: ${tier || "none yet"}\n\n` +
    "Please check whether they need girl verification, then give their tier + server access roles when ready."
  );
}

function buildButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BUTTON_CUSTOM_ID)
      .setLabel("I'm verified ✓")
      .setStyle(ButtonStyle.Success)
  );
}

async function dmOnboardingAdmins(client, content) {
  const adminIds = onboardingAdminIds();

  if (!adminIds.length) {
    throw new Error("ONBOARDING_ADMIN_USER_IDS is not configured");
  }

  let sent = 0;
  const errors = [];

  for (const adminId of adminIds) {
    try {
      const admin = await client.users.fetch(adminId);
      await admin.send(content);
      sent += 1;
    } catch (err) {
      errors.push(`${adminId}: ${err?.message || err}`);
      console.warn(
        `[VERIFICATION BUTTON] could not DM onboarding admin ${adminId}:`,
        err?.message || err
      );
    }
  }

  if (!sent) {
    throw new Error(
      `Failed to DM onboarding admins (${errors.join("; ") || "no recipients"})`
    );
  }

  return sent;
}

async function resolveMember(interaction) {
  return interaction.guild.members.fetch(interaction.user.id);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("verificationbutton")
    .setDescription("Post the onboarding verification button in this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: "Use this command in the server.",
        ephemeral: true
      });
    }

    if (!userIsStaff(interaction.member)) {
      return interaction.reply({
        content: "This command is staff-only.",
        ephemeral: true
      });
    }

    const channel = interaction.channel;

    if (!channel?.isTextBased?.()) {
      return interaction.reply({
        content: "This channel cannot receive the verification button.",
        ephemeral: true
      });
    }

    const me = channel.guild?.members?.me;
    const perms = me ? channel.permissionsFor(me) : null;

    if (perms && !perms.has(PermissionFlagsBits.SendMessages)) {
      return interaction.reply({
        content: `I don't have **Send Messages** permission in <#${channel.id}>.`,
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      await channel.send({
        components: [buildButtonRow()]
      });
    } catch (err) {
      console.error("[VERIFICATION BUTTON] failed to post button:", err);

      return interaction.editReply({
        content: "Failed to post the verification button in this channel."
      });
    }

    const adminCount = onboardingAdminIds().length;
    const accessConfigured = memberRoleIds().length > 0;

    const notes = [];

    if (!adminCount) {
      notes.push(
        "Set `ONBOARDING_ADMIN_USER_IDS` so button clicks can DM Plum and Billy."
      );
    }

    if (!accessConfigured) {
      notes.push(
        "Set `MEMBER_ROLE_ID` so members who already have access are not re-notified."
      );
    }

    return interaction.editReply({
      content:
        "Posted the **I'm verified ✓** button in this channel." +
        (notes.length ? `\n\n${notes.join("\n")}` : "")
    });
  },

  async handleButton(interaction) {
    if (interaction.customId !== BUTTON_CUSTOM_ID) {
      return false;
    }

    if (!interaction.guild) {
      await interaction.reply({
        content: "Use this button in the server.",
        ephemeral: true
      });
      return true;
    }

    const member = await resolveMember(interaction).catch(() => null);

    if (!member) {
      await interaction.reply({
        content: "Couldn't load your server profile. Please try again.",
        ephemeral: true
      });
      return true;
    }

    if (hasServerAccess(member)) {
      await interaction.reply({
        content: "You've already got server access 💜",
        ephemeral: true
      });
      return true;
    }

    if (!member.roles.cache.has(YUNITE_VERIFIED_ROLE_ID)) {
      await interaction.reply({
        content:
          `It looks like you haven't completed Yunite verification yet! Please head to <#${YUNITE_VERIFY_CHANNEL_ID}> first 💜`,
        ephemeral: true
      });
      return true;
    }

    const key = notifyKey(interaction.guild.id, interaction.user.id);

    if (notifiedMembers.has(key)) {
      await interaction.reply({
        content: "We've already let the team know you're waiting for roles 💜",
        ephemeral: true
      });
      return true;
    }

    notifiedMembers.add(key);

    try {
      await dmOnboardingAdmins(
        interaction.client,
        buildAdminDm(member, interaction.user)
      );
    } catch (err) {
      notifiedMembers.delete(key);
      console.error("[VERIFICATION BUTTON] admin notify failed:", err);

      await interaction.reply({
        content:
          "We couldn't reach the team just now. Please try again in a moment 💜",
        ephemeral: true
      });
      return true;
    }

    await interaction.reply({
      content:
        "Thanks! We've let the team know you're ready for the next step 💜",
      ephemeral: true
    });

    return true;
  }
};
