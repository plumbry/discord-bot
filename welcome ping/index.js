const { SlashCommandBuilder } = require("discord.js");

// ================= CONFIG =================
const VERIFY_CATEGORY_ID = "1405195809057669271";
const NEW_MEMBER_ROLE_ID = "1419812379692367902";
const WELCOME_CHANNEL_ID = "1471071557991272459";

// ================= AUTO DM MESSAGE =================
const WELCOME_DM = `👋 **Welcome to ZBD!**

You cannot play tournaments or scrims until **ALL steps below are done**:

1️⃣ Verify in https://discord.com/channels/1371615693392576580/1371647079935377418

2️⃣ **FEMALE players** open a ticket in https://discord.com/channels/1371615693392576580/1371651766407532654 to verify

3️⃣ React to the welcome message once finished *(roles are manual)*

⚠ **REQUIRED SETUP**  
Before playing, you **MUST** complete the in-game setup in https://discord.com/channels/1371615693392576580/1436327300915531867

Skipping this = you **cannot queue into customs**

Need help? Open a ticket **after verification**`;

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

// ================= ORIGINAL VERIFY MESSAGE =================
const VERIFY_MESSAGE = memberMention =>
`Hi ${memberMention}, we need to woman verify you if possible please! We have 2 ways we can do this:

• A quick face cam check - you would join a call in the server with a moderator, turn on your camera and say your username

OR

• A picture of your ID clearly showing your gender with a piece of paper with your discord name on it.

Your personal info can be crossed out. If you are 25+ and wish to "boomer verify" for future tournaments, do not cover your year of birth.

Let us know which option you prefer and we will get started!`;

// ================= ORIGINAL WELCOME LOGIC =================
let welcomeQueue = [];
let welcomeTimeout = null;

async function handleWelcome(member) {
  try {
    const role = await member.guild.roles.fetch(NEW_MEMBER_ROLE_ID);
    if (role) {
      await member.roles.add(role);
    }

    // ---------- AUTO DM (NEW, SAFE) ----------
    try {
      await member.send(WELCOME_DM);
    } catch {
      // DMs closed — ignore silently
    }

    // ---------- EXISTING WELCOME BATCH ----------
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

// ================= VERIFY HANDLER (SAFE) =================
async function handleVerify(interaction) {
  try {
    // MUST defer or reply before editReply (v14 requirement)
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

    // Final safety net
    if (!interaction.replied) {
      await interaction.reply({
        content: "Something went wrong while sending the verification message.",
        ephemeral: true,
      });
    }
  }
}

// ================= EXPORTS =================
module.exports = {
  verifyCommand,
  handleVerify,
  handleWelcome,
};