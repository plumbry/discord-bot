const { SlashCommandBuilder } = require("discord.js");
const { google } = require("googleapis");

// ================= CONFIG =================
const VERIFY_CATEGORY_ID = "1405195809057669271";
const NEW_MEMBER_ROLE_ID = "1419812379692367902";
const WELCOME_CHANNEL_ID = "1471071557991272459";

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

const SPREADSHEET_ID = "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM";
const WELCOME_DM_RANGE = "Welcome DMs!A:E";

// ================= AUTO DM MESSAGE (VERBATIM) =================
const WELCOME_DM = `:wave: Welcome to ZBD!

You cannot play tournaments or scrims until ALL steps below are done:

:one: Verify in [#yunite-verify](https://discord.com/channels/1371615693392576580/1371647079935377418)
:two: FEMALE players: open a ticket in [#create-ticket](https://discord.com/channels/1371615693392576580/1371651766407532654)
:three: React to the welcome message once finished (roles are manual)

⚠ REQUIRED SETUP
Before playing, you MUST complete the in-game setup in [#frequently-asked](https://discord.com/channels/1371615693392576580/1436327300915531867)
Skipping this = you cannot queue into customs!

Need help? Open a ticket after verification`;

// ================= VERIFY COMMAND =================
const verifyCommand = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Send verification message")
  .addUserOption(o =>
    o
      .setName("member")
      .setDescription("Member to verify")
      .setRequired(true)
  );

// ================= VERIFY MESSAGE (UNCHANGED) =================
const VERIFY_MESSAGE = memberMention =>
`Hi ${memberMention}, we need to woman verify you if possible please! We have 2 ways we can do this:

• A quick face cam check - you would join a call in the server with a moderator, turn on your camera and say your username

OR

• A picture of your ID clearly showing your gender with a piece of paper with your discord name on it.

Your personal info can be crossed out. If you are 25+ and wish to "boomer verify" for future tournaments, do not cover your year of birth.

Let us know which option you prefer and we will get started!`;

// ================= WELCOME BATCHING =================
let welcomeQueue = [];
let welcomeTimeout = null;

async function logWelcomeDM(member, status, error = "") {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: WELCOME_DM_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        new Date().toISOString(),
        member.id,
        member.user.tag,
        status,
        error
      ]]
    }
  });
}

async function handleWelcome(member) {
  try {
    const role = await member.guild.roles.fetch(NEW_MEMBER_ROLE_ID);
    if (role) {
      await member.roles.add(role);
    }

    // ---------- AUTO DM + LOG ----------
    try {
      await member.send(WELCOME_DM);
      await logWelcomeDM(member, "SENT");
    } catch (err) {
      await logWelcomeDM(
        member,
        "FAILED",
        err?.message || "DM blocked"
      );
    }

    // ---------- EXISTING PUBLIC WELCOME ----------
    welcomeQueue.push(member.id);

    if (!welcomeTimeout) {
      welcomeTimeout = setTimeout(async () => {
        if (!welcomeQueue.length) return;

        const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID);
        if (!channel || !channel.isTextBased()) return;

        const mentions = welcomeQueue
          .map(id => `<@${id}>`)
          .join(" ");

        await channel.send(
          `Welcome ${mentions}! 👋\n\nPlease follow the steps in the message at the top of this channel before continuing.`
        );

        welcomeQueue = [];
        welcomeTimeout = null;
      }, 45_000);
    }
  } catch (err) {
    console.error("handleWelcome error:", err);
  }
}

// ================= VERIFY HANDLER =================
async function handleVerify(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: false });
    }

    if (
      !interaction.channel ||
      interaction.channel.parentId !== VERIFY_CATEGORY_ID
    ) {
      return interaction.editReply("Wrong channel.");
    }

    const user = interaction.options.getUser("member");

    await interaction.editReply(
      VERIFY_MESSAGE(`<@${user.id}>`)
    );
  } catch (err) {
    console.error("handleVerify error:", err);
  }
}

// ================= EXPORTS =================
module.exports = {
  verifyCommand,
  handleVerify,
  handleWelcome
};