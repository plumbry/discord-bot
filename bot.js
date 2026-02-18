const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require("discord.js");

// Welcome / Verify (UNCHANGED)
const {
  verifyCommand,
  handleVerify,
  handleWelcome
} = require("./welcome ping");

// Event bans system
const {
  eventBanCommand,
  recentBanCommand,
  myBanCommand,
  handleEventBan,
  handleRecentBan,
  handleMyBan,
  checkProbationExpiry
} = require("./event bans/eventBans");

// DM system
const {
  dmCommand,
  handleDM
} = require("./commands/dm");

const GUILD_ID = "1371615693392576580";

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

  console.log("✅ Guild commands registered");
  console.log(`🤖 Logged in as ${client.user.tag}`);

  scheduleDailyProbationCheck(client);
});

// ================= MEMBER JOIN =================
client.on("guildMemberAdd", handleWelcome);

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "myban") {
    await interaction.deferReply({ ephemeral: true });
  }

  if (interaction.commandName === "verify") {
    return handleVerify(interaction);
  }

  if (interaction.commandName === "eventban") {
    return handleEventBan(interaction);
  }

  if (interaction.commandName === "recentban") {
    return handleRecentBan(interaction);
  }

  if (interaction.commandName === "myban") {
    return handleMyBan(interaction);
  }

  if (interaction.commandName === "dm") {
    return handleDM(interaction);
  }

  return interaction.reply("Unknown command.");
});

// ================= DAILY SCHEDULER =================
function scheduleDailyProbationCheck(client) {
  const now = new Date();
  const next = new Date();

  next.setHours(0, 1, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1);

  const delay = next.getTime() - now.getTime();

  setTimeout(async () => {
    try {
      await checkProbationExpiry(client);
    } catch (e) {
      console.error("Probation check failed:", e);
    }

    setInterval(async () => {
      try {
        await checkProbationExpiry(client);
      } catch (e) {
        console.error("Probation check failed:", e);
      }
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

client.login(process.env.DISCORD_TOKEN);
