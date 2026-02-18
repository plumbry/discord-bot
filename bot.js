const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");

// ================= DM SYSTEM =================
const {
  dmCommand,
  handleDM,
  handleDMButton,
  startDMScheduler
} = require("./commands/dm");

// ================= VERIFY / WELCOME =================
const {
  verifyCommand,
  handleVerify,
  handleWelcome
} = require("./welcome ping");

// ================= EVENT BANS =================
const {
  eventBanCommand,
  recentBanCommand,
  myBanCommand,
  handleEventBan,
  handleRecentBan,
  handleMyBan,
  checkProbationExpiry
} = require("./event bans/eventBans");

// ================= CONSTANTS =================
const GUILD_ID = "1371615693392576580";

// ================= DISCORD CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// ================= READY =================
client.once("ready", async () => {
  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    {
      body: [
        verifyCommand.toJSON(),
        eventBanCommand.toJSON(),
        recentBanCommand.toJSON(),
        myBanCommand.toJSON(),
        dmCommand.toJSON()
      ]
    }
  );

  console.log(`🤖 Logged in as ${client.user.tag}`);

  // ✅ Start schedulers (ONLY here)
  startDMScheduler(client);
  scheduleDailyProbationCheck(client);
});

// ================= DAILY PROBATION =================
function scheduleDailyProbationCheck(client) {
  const now = new Date();
  const next = new Date();
  next.setHours(0, 1, 0, 0);

  if (now >= next) next.setDate(next.getDate() + 1);

  setTimeout(() => {
    checkProbationExpiry(client);
    setInterval(
      () => checkProbationExpiry(client),
      24 * 60 * 60 * 1000
    );
  }, next - now);
}

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "verify") return handleVerify(interaction);
    if (interaction.commandName === "eventban") return handleEventBan(interaction);
    if (interaction.commandName === "recentban") return handleRecentBan(interaction);
    if (interaction.commandName === "myban") {
      await interaction.deferReply({ ephemeral: true });
      return handleMyBan(interaction);
    }
    if (interaction.commandName === "dm") return handleDM(interaction);
  }

  if (interaction.isButton()) {
    return handleDMButton(interaction);
  }
});

client.on("guildMemberAdd", handleWelcome);

client.login(process.env.DISCORD_TOKEN);
