const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require("discord.js");

const { getSheets } = require("../lib/sheets");

const {
  getRows,
  getSignupBlockReason,
  formatSignupBlockMessage
} = require("../event-bans/eventBans");

const {
  formatInvalidTierSignupMessage,
  validateTeamTierCombo
} = require("../lib/tierRestrictions");

// ================= CONSTANTS =================
const LOG_CHANNEL_ID = "1471082166535454780";
const SHEET_ID = process.env.MAIN_SHEET_ID;
const AUDIT_RANGE = "Audit Log!A:G";

const MESSAGE_SCAN_LIMIT = 100;
const ROLE_BATCH_SIZE = 5;
const ROLE_BATCH_DELAY_MS = 200;
const REACTION_DELAY_MS = 100;
const REACT_ADD_DELAY_MS = 300;
const BAN_PROMPT_TIMEOUT_MS = 120_000;

// ================= EMOJIS =================
const ACCEPTED_EMOJI_ID = "1405510864496361482";

const NUMBER_EMOJIS = {
  "0": "1405509686194864188",
  "1": "1405509032705392685",
  "2": "1405509125500309636",
  "3": "1405509179291992165",
  "4": "1405509225144389734",
  "5": "1405509441054572577",
  "6": "1405509486533148763",
  "7": "1405509549246386218",
  "8": "1405509615529230347",
  "9": "1405509655702274210"
};

const DUPLICATE_NUMBER_EMOJIS = {
  "1": "1436347038630416499",
  "2": "1436348495102480424",
  "3": "1436348527448952923",
  "4": "1436348563591266424",
  "5": "1436348591986708601",
  "6": "1436348649616707695",
  "7": "1436348677341053069",
  "8": "1436348705652478004",
  "9": "1436348734731587645"
};

// ================= TEAM LIMITS =================
const TEAM_LIMITS = {
  normal: {
    1: 100,
    2: 50,
    3: 33,
    4: 25
  },
  reload: {
    1: 40,
    2: 20,
    3: 13,
    4: 10
  }
};

const MODE_LABELS = {
  1: "Solo",
  2: "Duos",
  3: "Trios",
  4: "Squads"
};

const RELOAD_STOP_EMOJI = "✋";

const RELOAD_K_EMOJI =
  "1435978450958553130";

const MANAGED_REACTION_EMOJIS =
  new Set([
    ACCEPTED_EMOJI_ID,
    RELOAD_STOP_EMOJI,
    RELOAD_K_EMOJI,
    ...Object.values(NUMBER_EMOJIS),
    ...Object.values(DUPLICATE_NUMBER_EMOJIS)
  ]);

// ================= HELPERS =================
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const isoNow = () => new Date().toISOString();

async function logAudit(data) {
  await getSheets().spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: AUDIT_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        isoNow(),
        data.action,
        data.moderator.id,
        data.moderator.tag,
        "",
        "",
        data.context
      ]]
    }
  });
}

function getNumberReactionEmojis(number) {
  const digits =
    number
    .toString()
    .split("");

  const digitUsage = {};
  const emojis = [];

  for (const digit of digits) {
    if (!digitUsage[digit]) {
      digitUsage[digit] = 0;
    }

    digitUsage[digit]++;

    const emoji =
      digitUsage[digit] === 1
        ? NUMBER_EMOJIS[digit]
        : DUPLICATE_NUMBER_EMOJIS[digit];

    if (emoji) {
      emojis.push(
        emoji
      );
    }
  }

  return emojis;
}

function managedReactionsLookCorrect(
  message,
  expectedEmojis
) {

  const botManaged = [];

  for (const reaction of message.reactions.cache.values()) {

    const emoji =
      reaction.emoji.id ||
      reaction.emoji.name;

    if (!MANAGED_REACTION_EMOJIS.has(emoji)) {
      continue;
    }

    if (reaction.count > 1 || !reaction.me) {
      return false;
    }

    botManaged.push(emoji);

  }

  return (
    botManaged.length === expectedEmojis.length &&
    botManaged.every(
      (emoji, index) => emoji === expectedEmojis[index]
    )
  );

}

async function reconcileManagedReactions(message, botUserId, expectedEmojis) {

  if (message.partial) {
    await message.fetch();
  }

  if (managedReactionsLookCorrect(message, expectedEmojis)) {
    return new Set(expectedEmojis);
  }

  const existingBotManaged = [];

  for (const reaction of message.reactions.cache.values()) {

    const emoji =
      reaction.emoji.id ||
      reaction.emoji.name;

    if (!MANAGED_REACTION_EMOJIS.has(emoji)) {
      continue;
    }

    if (reaction.count > 1 || !reaction.me) {

      const users = await reaction.users.fetch();

      for (const user of users.values()) {

        if (user.id !== botUserId) {
          await reaction.users.remove(user.id);
          await delay(REACTION_DELAY_MS);
        }

      }

    }

    if (reaction.me) {
      existingBotManaged.push({
        reaction,
        emoji
      });
    }

  }

  const existingEmojis =
    existingBotManaged.map(
      item => item.emoji
    );

  const alreadyCorrect =
    existingEmojis.length === expectedEmojis.length &&
    existingEmojis.every(
      (emoji, index) => emoji === expectedEmojis[index]
    );

  if (alreadyCorrect) {
    return new Set(
      existingEmojis
    );
  }

  for (const item of existingBotManaged) {
    await item.reaction.users.remove(
      botUserId
    );
    await delay(REACTION_DELAY_MS);
  }

  return new Set();
}

async function reactIfMissing(message, emoji, existing) {
  if (
    existing.has(
      emoji
    )
  ) {
    return;
  }

  await message.react(
    emoji
  );

  await delay(REACT_ADD_DELAY_MS);

  existing.add(
    emoji
  );
}

async function assignRolesInBatches(
  guild,
  userIds,
  role
) {

  let added = 0;
  let skipped = 0;
  const ids = [...userIds];

  for (let i = 0; i < ids.length; i += ROLE_BATCH_SIZE) {

    const batch = ids.slice(i, i + ROLE_BATCH_SIZE);

    await Promise.all(
      batch.map(async (userId) => {

        let member = guild.members.cache.get(userId);

        if (!member) {
          member = await guild.members.fetch(userId).catch(() => null);
        }

        if (!member) {
          return;
        }

        if (member.roles.cache.has(role.id)) {
          skipped++;
          return;
        }

        try {
          await member.roles.add(role);
          added++;
        } catch (err) {
          console.error(err);
        }

      })
    );

    if (i + ROLE_BATCH_SIZE < ids.length) {
      await delay(ROLE_BATCH_DELAY_MS);
    }

  }

  return { added, skipped };

}

function buildFlaggedBanSummary(flaggedTeams) {

  const lines = flaggedTeams.map(({ team, blockReason }) =>
    `• ${team.users.map(u => `<@${u.id}>`).join(" ")} — ${formatSignupBlockMessage(blockReason)}`
  );

  return lines.join("\n").slice(0, 3500);

}

async function promptBannedTeamDecision(interaction, flaggedTeams) {

  const summary = buildFlaggedBanSummary(flaggedTeams);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`roletagged_ban_skip_${interaction.id}`)
      .setLabel("Skip banned teams")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`roletagged_ban_include_${interaction.id}`)
      .setLabel("Role banned teams too")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`roletagged_ban_cancel_${interaction.id}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );

  const prompt = await interaction.followUp({
    content:
      `**${flaggedTeams.length} signup team(s) include players with an active event ban** ` +
      `\n\n${summary}\n\nChoose how to continue:`,
    components: [row],
    ephemeral: true
  });

  try {

    const choice = await prompt.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: BAN_PROMPT_TIMEOUT_MS,
      filter: i =>
        i.user.id === interaction.user.id &&
        i.customId.endsWith(interaction.id)
    });

    await choice.deferUpdate();

    await prompt.edit({
      content: choice.component.label + " — continuing…",
      components: []
    });

    if (choice.customId.startsWith("roletagged_ban_cancel_")) {
      return "cancel";
    }

    if (choice.customId.startsWith("roletagged_ban_include_")) {
      return "include";
    }

    return "skip";

  } catch {

    await prompt.edit({
      content: "Timed out — cancelled. Run /roletagged again.",
      components: []
    }).catch(() => {});

    return "cancel";

  }

}

async function finishRoletagged(
  interaction,
  {
    validTeams,
    skippedBannedTeams,
    includedDespiteBan,
    tierRejectedCount,
    ignoreTierRestrictions,
    role,
    isReload,
    requiredTeamSize,
    channel,
    guild
  }
) {

  if (validTeams.length === 0) {

    return interaction.editReply(
      "No teams selected for role assignment."
    );

  }

  const teamLimit =
    TEAM_LIMITS[isReload ? "reload" : "normal"][requiredTeamSize];

  const roledTeams =
    validTeams.slice(0, teamLimit);

  const overflowTeams =
    validTeams.slice(teamLimit);

  const roledUserIds =
    new Set();

  for (const team of roledTeams) {

    for (const user of team.users) {
      roledUserIds.add(user.id);
    }

  }

  const { added, skipped } = await assignRolesInBatches(
    guild,
    roledUserIds,
    role
  );

  let teamNumber = 1;

  for (const team of roledTeams) {

    try {

      const expectedEmojis = [
        ACCEPTED_EMOJI_ID,
        ...getNumberReactionEmojis(teamNumber)
      ];

      const existing =
        await reconcileManagedReactions(
          team.message,
          interaction.client.user.id,
          expectedEmojis
        );

      for (const emojiId of expectedEmojis) {
        await reactIfMissing(
          team.message,
          emojiId,
          existing
        );
      }

    } catch (err) {

      console.error("[REACT ERROR]", err);

    }

    teamNumber++;

  }

  if (overflowTeams.length > 0) {

    let overflowNumber = 1;

    for (const team of overflowTeams) {

      try {

        const expectedEmojis = [
          RELOAD_STOP_EMOJI,
          RELOAD_K_EMOJI,
          ...getNumberReactionEmojis(overflowNumber)
        ];

        const existing =
          await reconcileManagedReactions(
            team.message,
            interaction.client.user.id,
            expectedEmojis
          );

        for (const emojiId of expectedEmojis) {
          await reactIfMissing(
            team.message,
            emojiId,
            existing
          );
        }

      } catch (err) {

        console.error("[OVERFLOW REACT ERROR]", err);

      }

      overflowNumber++;

    }

  }

  const banNote = includedDespiteBan
    ? "\nBanned teams: included by moderator"
    : skippedBannedTeams.length > 0
      ? `\nBanned teams skipped: ${skippedBannedTeams.length}`
      : "";

  const tierNote =
    ignoreTierRestrictions
      ? "\nTier restrictions: ignored (temporary override)"
      : tierRejectedCount > 0
      ? `\nInvalid tier combos rejected: ${tierRejectedCount}`
      : "";

  const result =

    "Role assignment complete\n" +
      "Mode: " + (MODE_LABELS[requiredTeamSize] || requiredTeamSize) + "\n" +
      "Reload: " + (isReload ? "Yes" : "No") + "\n" +
    "Role: " + role.name + "\n" +
    "Added: " + added + "\n" +
    "Skipped: " + skipped + "\n" +
    "Valid Teams: " + validTeams.length + "\n" +
    "Roled Teams: " + roledTeams.length + "\n" +
    "Overflow Teams: " + overflowTeams.length +
    banNote +
    tierNote;

  await interaction.editReply(result);

  try {

    const logChannel =
      await guild.channels.fetch(LOG_CHANNEL_ID);

    await logChannel.send(

      "Role Assigned via /roletagged\n" +
      "Moderator: " +
      interaction.user.tag +
      "\nRole: " +
      role.name +
      "\nMode: " +
      (MODE_LABELS[requiredTeamSize] || requiredTeamSize) +
      "\nReload: " +
      (isReload ? "Yes" : "No") +
      "\nTier restrictions: " +
      (ignoreTierRestrictions ? "Ignored" : "Enforced") +
      "\nTeams: " +
      validTeams.length +
      banNote +
      tierNote
    );

  } catch {}

  try {

    await logAudit({

      action: "ROLE_TAGGED_ASSIGN",

      moderator: interaction.user,

      context:
        `role=${role.id} mode=${requiredTeamSize} reload=${isReload} teams=${validTeams.length} ` +
        `included_banned=${includedDespiteBan} skipped_banned=${skippedBannedTeams.length} ` +
        `ignore_tier_restrictions=${ignoreTierRestrictions}`
    });

  } catch (err) {

    console.error(err);

  }

}

// ================= COMMAND =================
module.exports = {

  data: new SlashCommandBuilder()
    .setName("roletagged")
    .setDescription("Give roles to tagged users from signups")

    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to give")
        .setRequired(true)
    )

    .addStringOption(o =>
      o.setName("mode")
        .setDescription("Team size")
        .setRequired(true)
        .addChoices(
          { name: "Solos (no tier check)", value: "1" },
          { name: "Duos", value: "2" },
          { name: "Trios", value: "3" },
          { name: "Squads", value: "4" }
        )
    )

    .addBooleanOption(o =>
      o.setName("reload")
        .setDescription("Reload mode (reduced team limits)")
        .setRequired(false)
    )

    .addBooleanOption(o =>
      o.setName("ignore_tier_restrictions")
        .setDescription("Temporary: bypass tier combo checks")
        .setRequired(false)
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageRoles
    ),

  async execute(interaction) {

    if (!process.env.MAIN_SHEET_ID) {
      return interaction.reply({
        content: "MAIN_SHEET_ID not configured.",
        ephemeral: true
      });
    }

    const role =
      interaction.options.getRole("role");

    const isReload =
      interaction.options.getBoolean("reload") || false;

    const ignoreTierRestrictions =
      interaction.options.getBoolean("ignore_tier_restrictions") || false;

    const requiredTeamSize =
      parseInt(
        interaction.options.getString("mode")
      );

    const channel = interaction.channel;
    const guild = interaction.guild;

    await interaction.deferReply();

    let eventBanRows = [];

    try {
      eventBanRows = await getRows();
    } catch (err) {
      console.error("[ROLETAGGED] Event ban sheet read failed:", err);
      return interaction.editReply(
        "Could not load Event Bans sheet. Try again later."
      );
    }

    const messages =
      await channel.messages.fetch({
        limit: MESSAGE_SCAN_LIMIT
      });

    const eligibleTeams = [];

    const flaggedTeams = [];

    const candidateTeams = [];

    const playerSignupMap =
      new Map();

    const orderedMessages =
      [...messages.values()].reverse();

    // ================= SCAN =================

    for (const msg of orderedMessages) {

      const users =
        [...msg.mentions.users.values()]
        .filter(u => !u.bot);

      if (users.length === 0)
        continue;

      // Wrong team size
      if (
        users.length !== requiredTeamSize
      ) {
        continue;
      }

      candidateTeams.push({
        message: msg,
        users
      });

      for (const user of users) {

        if (
          !playerSignupMap.has(
            user.id
          )
        ) {
          playerSignupMap.set(
            user.id,
            []
          );
        }

        playerSignupMap
          .get(user.id)
          .push(msg.id);
      }
    }

    // ================= DUPLICATES =================

    const duplicatePlayers =
      new Set();

    for (const [id, signups]
      of playerSignupMap) {

      if (
        signups.length > 1
      ) {
        duplicatePlayers.add(
          id
        );
      }
    }

    // ================= VALIDATE =================

    let tierRejectedCount = 0;

    for (const team of candidateTeams) {

      const hasDuplicate =
        team.users.some(
          u =>
          duplicatePlayers.has(
            u.id
          )
        );

      if (hasDuplicate) {

        try {

          await channel.send(
            `Rejected signup (duplicate player): ${team.users.map(
              u => `<@${u.id}>`
            ).join(" ")}`
          );

        } catch {}

        continue;
      }

      if (requiredTeamSize > 1 && !ignoreTierRestrictions) {

        const tierCheck = await validateTeamTierCombo(
          guild,
          team.users,
          requiredTeamSize
        );

        if (!tierCheck.ok) {

          tierRejectedCount++;

          try {

            await channel.send(
              formatInvalidTierSignupMessage({
                users: team.users,
                tiers: tierCheck.tiers,
                teamSize: requiredTeamSize,
                reason: tierCheck.reason,
                ambiguousUser: tierCheck.ambiguousUser
              })
            );

          } catch {}

          continue;

        }

      }

      let blockReason = null;

      for (const user of team.users) {

        blockReason = getSignupBlockReason(
          user.id,
          eventBanRows
        );

        if (blockReason) {
          break;
        }

      }

      if (blockReason) {

        flaggedTeams.push({
          team,
          blockReason
        });

        continue;
      }

      eligibleTeams.push(team);

    }

    if (
      eligibleTeams.length === 0 &&
      flaggedTeams.length === 0
    ) {

      return interaction.editReply(
        "No eligible signups found."
      );
    }

    let validTeams = [...eligibleTeams];
    let skippedBannedTeams = [];
    let includedDespiteBan = false;

    if (flaggedTeams.length > 0) {

      await interaction.editReply(
        `Scan complete. Found **${flaggedTeams.length}** team(s) with an active event ban. Choose an option below (only you can see this).`
      );

      const decision =
        await promptBannedTeamDecision(
          interaction,
          flaggedTeams
        );

      if (decision === "cancel") {

        return interaction.editReply(
          "Cancelled — no roles were assigned."
        );

      }

      if (decision === "include") {

        validTeams = [
          ...eligibleTeams,
          ...flaggedTeams.map(item => item.team)
        ];

        includedDespiteBan = true;

      } else {

        skippedBannedTeams = flaggedTeams;

        for (const { team, blockReason } of flaggedTeams) {

          try {

            await channel.send(
              `Skipped signup (event ban): ${team.users.map(
                u => `<@${u.id}>`
              ).join(" ")}\n${formatSignupBlockMessage(blockReason)}`
            );

          } catch {}

        }

      }

    }

    if (validTeams.length === 0) {

      return interaction.editReply(
        "No teams selected for role assignment."
      );
    }

    await finishRoletagged(interaction, {
      validTeams,
      skippedBannedTeams,
      includedDespiteBan,
      tierRejectedCount,
      ignoreTierRestrictions,
      role,
      isReload,
      requiredTeamSize,
      channel,
      guild
    });

  }
};
