```js id="x9r5we"
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

// ================= GOOGLE SHEETS =================
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
const delay = ms => new Promise(r => setTimeout(r, ms));
const isoNow = () => new Date().toISOString();

async function logAudit({ action, moderator, context }) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: AUDIT_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        isoNow(),
        action,
        moderator.id,
        moderator.tag,
        "",
        "",
        context
      ]]
    }
  });
}

// ================= COMMAND =================
module.exports = {
  data: new SlashCommandBuilder()
    .setName("roletagged")
    .setDescription("Give a role to all users mentioned in this channel")
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to give to tagged users")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {

    if (!process.env.MAIN_SHEET_ID) {
      return interaction.reply({
        content: "❌ MAIN_SHEET_ID is not configured.",
        ephemeral: true
      });
    }

    const role = interaction.options.getRole("role");
    const channel = interaction.channel;
    const guild = interaction.guild;

    await interaction.reply("🔍 Scanning tagged users…");

    const messages = await channel.messages.fetch({ limit: MESSAGE_SCAN_LIMIT });

    const taggedUserIds = new Set();

    for (const msg of messages.values()) {
      for (const user of msg.mentions.users.values()) {
        if (!user.bot) taggedUserIds.add(user.id);
      }
    }

    if (taggedUserIds.size === 0) {
      return interaction.editReply("❌ No tagged users found in recent messages.");
    }

    await guild.members.fetch();

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
      `✅ **Role assignment complete**\n` +
      `Role: ${role}\n` +
      `Added to: **${added}** members\n` +
      `Already had role: **${skipped}**`;

    await interaction.editReply(resultMessage);

    try {
      const logChannel = await guild.channels.fetch(LOG_CHANNEL_ID);
      await logChannel.send(
        `🏷️ **Role Assigned via /roletagged**\n` +
        `Moderator: ${interaction.user.tag}\n` +
        `Channel: ${channel}\n` +
        `Role: ${role}\n` +
        `Added to: **${added}** members`
      );
    } catch {}

    try {
      await logAudit({
        action: "ROLE_TAGGED_ASSIGN",
        moderator: interaction.user,
        context: `role=${role.id} channel=${channel.id} added=${added}`
      });
    } catch (err) {
      console.error("[ROLETAGGED AUDIT ERROR]", err);
    }
  }
};
```
