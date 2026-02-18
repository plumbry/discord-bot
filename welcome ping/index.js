const { SlashCommandBuilder } = require("discord.js");

// ================= CONFIG =================
const VERIFY_CATEGORY_ID = "1405195809057669271";
const NEW_MEMBER_ROLE_ID = "1419812379692367902";
const WELCOME_CHANNEL_ID = "1471071557991272459";

// ================= VERIFY COMMAND =================
const verifyCommand = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Send verification message")
  .addUserOption(o =>
    o.setName("member")
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
  if (!interaction.channel || interaction.channel.parentId !== VERIFY_CATEGORY_ID) {
    return interaction.editReply("Wrong channel.");
  }

  const user = interaction.options.getUser("member");
  return interaction.editReply(
    VERIFY_MESSAGE(`<@${user.id}>`)
  );
}

// ================= EXPORTS =================
module.exports = {
  verifyCommand,
  handleVerify,
  handleWelcome
};
