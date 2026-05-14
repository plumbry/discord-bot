const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { google } = require("googleapis");

// ================= CONSTANTS =================
const LOG_CHANNEL_ID = "1471082166535454780";
const SHEET_ID = process.env.MAIN_SHEET_ID;
const AUDIT_RANGE = "Audit Log!A:G";

const MESSAGE_SCAN_LIMIT = 100;
const ROLE_DELAY_MS = 750;

const BLOCKED_ROLE_ID = "1463660686231207956";

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

// ================= GOOGLE =================
const credentials = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// ================= HELPERS =================
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const isoNow = () => new Date().toISOString();

async function logAudit(data) {
  await sheets.spreadsheets.values.append({
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

// ================= COMMAND =================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("roletagged")
    .setDescription("Give a role to all users mentioned in recent messages")

    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to give to tagged users")
        .setRequired(true)
    )

    .addBooleanOption(o =>
      o.setName("skip")
        .setDescription("Ignore event banned checks and process all teams")
        .setRequired(false)
    )

    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {

    if (!process.env.MAIN_SHEET_ID) {
      return interaction.reply({
        content: "MAIN_SHEET_ID is not configured.",
        ephemeral: true
      });
    }

    const role = interaction.options.getRole("role");
    const ignoreBlocked = interaction.options.getBoolean("skip") || false;

    const channel = interaction.channel;
    const guild = interaction.guild;

    await interaction.reply("Scanning tagged users...");

    const messages = await channel.messages.fetch({
      limit: MESSAGE_SCAN_LIMIT
    });

    await guild.members.fetch();

    const taggedUserIds = new Set();

    // Valid teams in signup order
    const validTeams = [];

    // Reverse so oldest signup becomes Team 1
    const orderedMessages = [...messages.values()].reverse();

    for (const msg of orderedMessages) {

      const mentionedUsers = [...msg.mentions.users.values()]
        .filter(user => !user.bot);

      if (mentionedUsers.length === 0) continue;

      let blockedMember = null;

      if (!ignoreBlocked) {

        for (const user of mentionedUsers) {

          const member = guild.members.cache.get(user.id);

          if (member?.roles.cache.has(BLOCKED_ROLE_ID)) {
            blockedMember = member;
            break;
          }
        }
      }

      // Skip ENTIRE team if any member is blocked
      if (blockedMember) {

        try {
          await channel.send(
            `${blockedMember} cannot sign up for the event. Their entire signup message was skipped.`
          );
        } catch {}

        continue;
      }

      // Store valid team
      validTeams.push({
        message: msg,
        users: mentionedUsers
      });

      // Queue users for role assignment
      for (const user of mentionedUsers) {
        taggedUserIds.add(user.id);
      }
    }

    if (taggedUserIds.size === 0) {
      return interaction.editReply(
        "No eligible tagged users found in recent messages."
      );
    }

    // ================= ROLE ASSIGNMENT =================
    let added = 0;
    let skipped = 0;

    for (const userId of taggedUserIds) {

      const member = guild.members.cache.get(userId);

      if (!member) continue;

      if (member.roles.cache.has(role.id)) {
        skipped++;
        continue;
      }

      try {
        await member.roles.add(role);
        added++;
      } catch (err) {
        console.error("[ROLE ADD ERROR]", err);
      }

      await delay(ROLE_DELAY_MS);
    }

    // ================= TEAM REACTIONS =================
    let teamNumber = 1;

    for (const team of validTeams) {

      try {

        await team.message.fetch();

        const existingReactionIds = team.message.reactions.cache.map(
          r => r.emoji.id
        );

        const hasAccepted =
          existingReactionIds.includes(ACCEPTED_EMOJI_ID);

        const hasNumberReaction =
          Object.values(NUMBER_EMOJIS).some(id =>
            existingReactionIds.includes(id)
          );

        // ================= EXISTING NUMBERED TEAM =================
        // Already processed before.
        // Count it and move to next team number.
        if (hasAccepted && hasNumberReaction) {

          console.log(
            "[ROLETAGGED] Existing numbered signup detected:",
            team.message.id,
            "-> Team",
            teamNumber
          );

          teamNumber++;
          continue;
        }

        // ================= RESTORE ACCEPTED =================
        if (!hasAccepted) {

          await team.message.react(ACCEPTED_EMOJI_ID);

          await delay(500);
        }

        // ================= APPLY TEAM NUMBER =================
        const digits = teamNumber.toString().split("");

        for (const digit of digits) {

          const emojiId = NUMBER_EMOJIS[digit];

          if (!emojiId) continue;

          // Add only missing digit reactions
          if (!existingReactionIds.includes(emojiId)) {

            await team.message.react(emojiId);

            await delay(500);
          }
        }

      } catch (err) {
        console.error("[ROLETAGGED REACT ERROR]", err);
      }

      teamNumber++;
    }

    // ================= RESULT =================
    const resultMessage =
      "Role assignment complete\n" +
      "Role: " + role.name + "\n" +
      "Added to: " + added + " members\n" +
      "Already had role: " + skipped + "\n" +
      "Valid teams processed: " + validTeams.length + "\n" +
      "Skip blocked checks: " + ignoreBlocked;

    await interaction.editReply(resultMessage);

    // ================= LOG CHANNEL =================
    try {

      const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID);

      await logChannel.send(
        "Role Assigned via /roletagged\n" +
        "Moderator: " + interaction.user.tag + "\n" +
        "Channel: " + channel.id + "\n" +
        "Role: " + role.name + "\n" +
        "Added to: " + added + "\n" +
        "Teams: " + validTeams.length + "\n" +
        "Skip blocked: " + ignoreBlocked
      );

    } catch {}

    // ================= SHEET AUDIT =================
    try {

      await logAudit({
        action: "ROLE_TAGGED_ASSIGN",
        moderator: interaction.user,
        context:
          "role=" + role.id +
          " channel=" + channel.id +
          " added=" + added +
          " teams=" + validTeams.length +
          " skipBlocked=" + ignoreBlocked
      });

    } catch (err) {
      console.error("[ROLETAGGED AUDIT ERROR]", err);
    }
  }
};