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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {

    if (!process.env.MAIN_SHEET_ID) {
      return interaction.reply({
        content: "MAIN_SHEET_ID is not configured.",
        ephemeral: true
      });
    }

    const role = interaction.options.getRole("role");
    const channel = interaction.channel;
    const guild = interaction.guild;

    await interaction.reply("Scanning tagged users...");

    const messages = await channel.messages.fetch({ limit: MESSAGE_SCAN_LIMIT });

    await guild.members.fetch();

    const taggedUserIds = new Set();

    for (const msg of messages.values()) {

      const mentionedUsers = [...msg.mentions.users.values()]
        .filter(user => !user.bot);

      if (mentionedUsers.length === 0) continue;

      let blockedMember = null;

      for (const user of mentionedUsers) {
        const member = guild.members.cache.get(user.id);

        if (member?.roles.cache.has(BLOCKED_ROLE_ID)) {
          blockedMember = member;
          break;
        }
      }

      // If ANY player in the message is blocked,
      // skip ALL players from that message
      if (blockedMember) {
        try {
          await channel.send(
            `${blockedMember} cannot sign up for the event. Their entire signup message was skipped.`
          );
        } catch {}

        continue;
      }

      // Otherwise add everyone from the message
      for (const user of mentionedUsers) {
        taggedUserIds.add(user.id);
      }
    }

    if (taggedUserIds.size === 0) {
      return interaction.editReply("No eligible tagged users found in recent messages.");
    }

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
      } catch {}

      await delay(ROLE_DELAY_MS);
    }

    const resultMessage =
      "Role assignment complete\n" +
      "Role: " + role.name + "\n" +
      "Added to: " + added + " members\n" +
      "Already had role: " + skipped;

    await interaction.editReply(resultMessage);

    // ================= LOG CHANNEL =================
    try {
      const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID);

      await logChannel.send(
        "Role Assigned via /roletagged\n" +
        "Moderator: " + interaction.user.tag + "\n" +
        "Channel: " + channel.id + "\n" +
        "Role: " + role.name + "\n" +
        "Added to: " + added
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
          " added=" + added
      });

    } catch (err) {
      console.error("[ROLETAGGED AUDIT ERROR]", err);
    }
  }
};