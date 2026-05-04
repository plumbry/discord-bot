console.log("=== BOT STARTING ===");

// ================= CORE =================

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const http = require("http");

// ================= ERROR HANDLING =================

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

// ================= ENV =================

const SUBMIT_SHEET_ID = process.env.SUBMIT_SHEET_ID;
const MAIN_SHEET_ID = process.env.MAIN_SHEET_ID;

console.log("ENV CHECK:", {
  DISCORD_TOKEN: !!process.env.DISCORD_TOKEN,
  GOOGLE: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
  MAIN: !!MAIN_SHEET_ID,
  SUBMIT: !!SUBMIT_SHEET_ID
});

// ================= IMPORT MODULES =================

const {
  verifyCommand,
  handleVerify,
  handleWelcome
} = require("./welcome ping");

// ✅ FIXED: only import what actually exists
const {
  eventBanCommand,
  handleEventBan
} = require("./event bans/eventBans");

// Optional modules (safe require)
let startBanExpiryChecker;
try {
  ({ startBanExpiryChecker } = require("./banExpiryChecker"));
  console.log("✅ banExpiryChecker loaded");
} catch (err) {
  console.error("❌ Failed to load banExpiryChecker:", err.message);
}

let dm = null;
try {
  dm = require("./commands/dm");
  console.log("✅ DM module loaded");
} catch (err) {
  console.error("⚠️ DM module not loaded:", err.message);
}

// ================= CLIENT =================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

client.commands = new Map();

console.log("=== CLIENT CREATED ===");

// ================= LOAD COMMANDS =================

const commandsPath = path.join(__dirname, "commands");

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
  try {
    const command = require(`./commands/${file}`);

    if (!command?.data || !command?.execute) continue;

    client.commands.set(command.data.name, command);

  } catch (err) {
    console.error(`❌ Error loading command: ${file}`, err);
  }
}

// ================= READY =================

client.once("ready", async () => {

  console.log(`🚀 Logged in as ${client.user.tag}`);

  if (startBanExpiryChecker) {
    startBanExpiryChecker(client);
  }

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  const commands = [
    verifyCommand,
    eventBanCommand
  ];

  for (const command of client.commands.values()) {
    commands.push(command.data);
  }

  const commandJSON = commands
    .filter(c => c?.toJSON)
    .map(c => c.toJSON());

  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, "1371615693392576580"),
      { body: commandJSON }
    );
    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }

  // ================= DM SCHEDULER =================

  if (dm?.startDMScheduler && MAIN_SHEET_ID) {
    try {
      dm.startDMScheduler(client, MAIN_SHEET_ID);
      console.log("✅ DM scheduler started");
    } catch (err) {
      console.error("❌ DM scheduler error:", err);
    }
  } else {
    console.log("⚠️ DM scheduler disabled");
  }

});

// ================= INTERACTIONS =================

client.on("interactionCreate", async (interaction) => {

  if (!interaction.isChatInputCommand()) return;

  try {

    if (interaction.commandName === "verify")
      return handleVerify(interaction);

    if (interaction.commandName === "eventban")
      return handleEventBan(interaction);

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    await command.execute(interaction, {
      SUBMIT_SHEET_ID,
      MAIN_SHEET_ID
    });

  } catch (err) {
    console.error("❌ Interaction error:", err);
  }

});

// ================= FLY HEALTH SERVER =================

const PORT = process.env.PORT || 8080;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
}).listen(PORT, () => {
  console.log(`🌐 Health server running on ${PORT}`);
});

// ================= LOGIN =================

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("✅ Bot login successful"))
  .catch(err => console.error("❌ Login error:", err));