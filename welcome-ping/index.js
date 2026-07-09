const { SlashCommandBuilder } = require("discord.js");
const { getSheets } = require("../lib/sheets");

// ================= CONFIG =================
const VERIFY_CATEGORY_ID = "1405195809057669271";
const NEW_MEMBER_ROLE_ID = "1419812379692367902";
const WELCOME_CHANNEL_ID = "1471071557991272459";
const WELCOME_LOG_CHANNEL_ID = "1471082166535454780";

const SPREADSHEET_ID = process.env.MAIN_SHEET_ID;
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

// ================= BOOMER COMMAND =================
const boomerCommand = new SlashCommandBuilder()
  .setName("boomer")
  .setDescription("Send boomer verification message")
  .addUserOption(o =>
    o
      .setName("member")
      .setDescription("Member to verify")
      .setRequired(true)
  );

// ================= VERIFY MESSAGE =================
const VERIFY_MESSAGE = memberMention =>
`Hi ${memberMention}! As ZBD is a co-ed competitive Fortnite server, we verify all female players before they can compete. Unfortunately we've had people falsely claim to be female in the past, so this process helps us keep tournaments fair and ensures everyone can trust that teams meet our eligibility requirements. We have two quick ways to verify:

• **Facecam** – Join a quick call with a female moderator, turn on your camera, and say your Discord username.

OR

• **Photo ID** – Send a photo of your ID with a piece of paper showing your Discord name. You may cover any personal information - we only need to see your gender. Your ID is never stored.

If you're 25+ and would also like the Boomer role for future tournaments, please leave your birth year visible.

Let us know which option you'd prefer and we'll get you verified!`;

// ================= BOOMER MESSAGE =================
const BOOMER_MESSAGE = memberMention =>
`Hey! ${memberMention} You have two options:

• Send a picture of your ID (hiding confidential information such as name and address) but showing your age (must be 25+) — you must also have a piece of paper in the pic with your Discord username in

OR

• Show your boomer roles from the 'Boomer League' server`;

// ================= WELCOME BATCHING =================
let welcomeQueue = [];
let welcomeTimeout = null;

/** @type {Set<string>} */
const reactedWelcomeMembers = new Set();

async function logWelcomeDM(member, status, error = "") {
  await getSheets().spreadsheets.values.append({
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

// ================= WELCOME REACTION =================
async function handleWelcomeReaction(reaction, user) {
  if (user.bot) {
    return;
  }

  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch {
      return;
    }
  }

  const message = reaction.message;

  if (message.partial) {
    await message.fetch().catch(() => null);
  }

  if (
    !message?.guild ||
    message.channelId !== WELCOME_CHANNEL_ID ||
    message.author?.id !== message.client.user?.id ||
    !message.mentions.users.has(user.id)
  ) {
    return;
  }

  const dedupeKey = `${message.id}:${user.id}`;

  if (reactedWelcomeMembers.has(dedupeKey)) {
    return;
  }

  reactedWelcomeMembers.add(dedupeKey);

  try {
    const logChannel = await message.guild.channels.fetch(
      WELCOME_LOG_CHANNEL_ID
    );

    if (!logChannel?.isTextBased()) {
      reactedWelcomeMembers.delete(dedupeKey);
      return;
    }

    await logChannel.send(
      `<@${user.id}> reacted to their welcome message — ready for manual role assignment.\n` +
        `Message: https://discord.com/channels/${message.guild.id}/${message.channelId}/${message.id}`
    );
  } catch (err) {
    reactedWelcomeMembers.delete(dedupeKey);
    console.error("handleWelcomeReaction error:", err);
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

// ================= BOOMER HANDLER =================
async function handleBoomer(interaction) {
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
      BOOMER_MESSAGE(`<@${user.id}>`)
    );
  } catch (err) {
    console.error("handleBoomer error:", err);
  }
}

// ================= EXPORTS =================
module.exports = {
  verifyCommand,
  handleVerify,
  boomerCommand,
  handleBoomer,
  handleWelcome,
  handleWelcomeReaction
};