const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require("discord.js");

// ===== VERIFY / WELCOME (UNCHANGED) =====
const {
  verifyCommand,
  handleVerify,
  handleWelcome
} = require("./welcome ping");

// ===== EVENT BANS (UNCHANGED) =====
const {
  eventBanCommand,
  recentBanCommand,
  myBanCommand,
  handleEventBan,
  handleRecentBan,
  handleMyBan,
  checkProbationExpiry
} = require("./event bans/eventBans");

// ===== DM SYSTEM =====
const {
  dmCommand,
  handleDM,
  handleDMButton
} = require("./commands/dm");

const GUILD_ID = "1371615693392576580";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

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
  scheduleDailyProbationCheck(client);
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {

  // SLASH COMMANDS
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "myban") {
      await interaction.deferReply({ ephemeral: true });
    }

    if (interaction.commandName === "verify") return handleVerify(interaction);
    if (interaction.commandName === "eventban") return handleEventBan(interaction);
    if (interaction.commandName === "recentban") return handleRecentBan(interaction);
    if (interaction.commandName === "myban") return handleMyBan(interaction);
    if (interaction.commandName === "dm") return handleDM(interaction);

    return;
  }

  // BUTTON INTERACTIONS  ✅ THIS IS THE IMPORTANT PART
  if (interaction.isButton()) {
    return handleDMButton(interaction);
  }
});

client.on("guildMemberAdd", handleWelcome);

// ===== DAILY PROBATION CHECK (UNCHANGED) =====
function scheduleDailyProbationCheck(client) {
  const now = new Date();
  const next = new Date();
  next.setHours(0, 1, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1);

  const delay = next.getTime() - now.getTime();
  setTimeout(() => {
    checkProbationExpiry(client);
    setInterval(() => checkProbationExpiry(client), 86400000);
  }, delay);
}

client.login(process.env.DISCORD_TOKEN);
