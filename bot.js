console.log("=== BOT STARTING ===");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ================= SAFE REQUIRE =================

function safeRequire(label, paths) {
  for (const p of paths) {
    try {
      const mod = require(p);
      console.log(`✅ Loaded ${label} from ${p}`);
      return mod;
    } catch (err) {
      console.log(`⚠️ Failed ${label} from ${p}`);
    }
  }
  console.error(`❌ FAILED TO LOAD: ${label}`);
  return {};
}

// ================= ERROR HANDLING =================

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

// ================= IMPORT COMMAND MODULES =================

// Handles BOTH your current structure AND fixed structure
const welcomeModule = safeRequire("welcome", [
  "./welcome-ping",
  "./welcome ping",
]);

const eventBanModule = safeRequire("event bans", [
  "./event-bans/eventBans",
  "./event bans/eventBans",
]);

const banExpiryModule = safeRequire("banExpiryChecker", [
  "./banExpiryChecker"
]);

const dm = safeRequire("dm", [
  "./commands/dm"
]);

// Destructure safely
const {
  verifyCommand,
  handleVerify,
  handleWelcome
} = welcomeModule;

const {
  eventBanCommand,
  recentBanCommand,
  myBanCommand,
  handleEventBan,
  handleRecentBan,
  handleMyBan
} = eventBanModule;

const { startBanExpiryChecker } = banExpiryModule;

// ================= CONSTANTS =================

const GUILD_ID = "1371615693392576580";

// ================= CLIENT =================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Map();

// ================= LOAD COMMAND FILES =================

const commandsPath = path.join(__dirname, "commands");

if (!fs.existsSync(commandsPath)) {
  console.error("❌ Commands folder missing");
} else {
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(file => file.endsWith(".js"));

  for (const file of commandFiles) {
    try {
      const command = require(`./commands/${file}`);

      if (!command?.data || !command?.execute) {
        console.log(`❌ Skipped invalid command: ${file}`);
        continue;
      }

      console.log(`✅ Loaded command: ${command.data.name}`);
      client.commands.set(command.data.name, command);

    } catch (err) {
      console.error(`❌ Error loading command: ${file}`, err);
    }
  }
}

// ================= READY =================

client.once("ready", async () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);

  try {
    if (startBanExpiryChecker) {
      startBanExpiryChecker(client);
      console.log("✅ Ban expiry checker started");
    }
  } catch (err) {
    console.error("❌ Ban expiry checker failed:", err);
  }

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  const commands = [
    verifyCommand,
    eventBanCommand,
    recentBanCommand,
    myBanCommand
  ].filter(Boolean);

  // dynamic commands
  for (const command of client.commands.values()) {
    commands.push(command.data);
  }

  const commandJSON = commands
    .filter(c => c && typeof c.toJSON === "function")
    .map(c => c.toJSON());

  console.log("📦 REGISTERING COMMANDS:");
  commandJSON.forEach(cmd => console.log(`- ${cmd.name}`));

  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commandJSON }
    );
    console.log("✅ Commands registered");
  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }

  // SAFE DM START
  try {
    if (
      dm.startDMScheduler &&
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 &&
      process.env.SPREADSHEET_ID
    ) {
      dm.startDMScheduler(client);
      console.log("✅ DM scheduler started");
    } else {
      console.log("⚠️ DM scheduler disabled (missing env vars)");
    }
  } catch (err) {
    console.error("❌ DM scheduler failed:", err);
  }
});

// ================= INTERACTIONS =================

client.on("interactionCreate", async (interaction) => {

  try {

    if (interaction.isButton()) {
      if (handleVerify) {
        return handleVerify(interaction, client);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "verify" && handleVerify) {
      return handleVerify(interaction, client);
    }

    if (interaction.commandName === "eventban" && handleEventBan) {
      return handleEventBan(interaction);
    }

    if (interaction.commandName === "recentban" && handleRecentBan) {
      return handleRecentBan(interaction);
    }

    if (interaction.commandName === "myban" && handleMyBan) {
      await interaction.deferReply({ ephemeral: true });
      return handleMyBan(interaction);
    }

    if (interaction.commandName === "dm" && dm.handleDM) {
      return dm.handleDM(interaction);
    }

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      console.log("❌ Command not found:", interaction.commandName);
      return;
    }

    console.log(`▶ Executing: ${interaction.commandName}`);
    await command.execute(interaction, client);

  } catch (error) {

    console.error("❌ Interaction error:", error);

    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "There was an error executing this command.",
          ephemeral: true
        });
      } else {
        await interaction.reply({
          content: "There was an error executing this command.",
          ephemeral: true
        });
      }
    } catch {}
  }
});

// ================= LOGIN =================

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("✅ Bot login successful"))
  .catch(err => console.error("❌ Login error:", err));