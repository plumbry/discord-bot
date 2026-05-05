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

// ================= SAFE IMPORTS =================

let verifyCommand, handleVerify;

try {
  ({ verifyCommand, handleVerify } = require("./welcome-ping"));
  console.log("✅ welcome module loaded");
} catch (err) {
  console.error("❌ Failed to load welcome module:", err.message);
}

let eventBanCommand, handleEventBan;

try {
  ({ eventBanCommand, handleEventBan } = require("./event-bans/eventBans"));
  console.log("✅ event bans module loaded");
} catch (err) {
  console.error("❌ Failed to load event bans module:", err.message);
}

let startBanExpiryChecker;
try {
  ({ startBanExpiryChecker } = require("./banExpiryChecker"));
  console.log("✅ banExpiryChecker loaded");
} catch (err) {
  console.error("⚠️ banExpiryChecker not loaded:", err.message);
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

let commandFiles = [];

try {
  commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));
} catch (err) {
  console.error("❌ Failed to read commands folder:", err.message);
}

for (const file of commandFiles) {
  try {
    const command = require(`./commands/${file}`);

    if (command?.data && command?.execute) {
      client.commands.set(command.data.name, command);
      console.log("✅ Loaded command:", command.data.name);
    } else {
      console.log("⚠️ Skipped invalid command file:", file);
    }

  } catch (err) {
    console.error(`❌ Error loading command: ${file}`, err);
  }
}

// ================= READY =================

client.once("clientReady", async () => {

  console.log(`🚀 Logged in as ${client.user.tag}`);

  if (startBanExpiryChecker) {
    try {
      startBanExpiryChecker(client);
    } catch (err) {
      console.error("❌ Ban checker failed:", err);
    }
  }

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  const commands = [];

  if (verifyCommand) commands.push(verifyCommand);
  if (eventBanCommand) commands.push(eventBanCommand);

  for (const cmd of client.commands.values()) {
    commands.push(cmd.data);
  }

  const commandJSON = [];

  for (const c of commands) {
    try {
      if (!c || !c.name) {
        console.error("❌ Invalid command:", c);
        continue;
      }

      const json = c.toJSON();
      commandJSON.push(json);

      console.log("📦 Registering command:", c.name);

    } catch (err) {
      console.error("❌ BAD COMMAND:", c?.name);
      console.error(err);
    }
  }

  try {
    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        "1371615693392576580"
      ),
      { body: commandJSON }
    );

    console.log("✅ Slash commands registered");

  } catch (err) {
    console.error("❌ Command registration failed:", err);
  }

  // ================= DM =================

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

  console.log("🔥 Interaction received:", interaction.commandName);

  if (!interaction.isChatInputCommand()) return;

  try {

    if (interaction.commandName === "verify" && handleVerify)
      return handleVerify(interaction);

    if (interaction.commandName === "eventban" && handleEventBan)
      return handleEventBan(interaction);

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      console.log("❌ Command not found in Map:", interaction.commandName);
      return interaction.reply({
        content: "❌ Command not loaded.",
        ephemeral: true
      });
    }

    console.log("⚡ Executing command:", interaction.commandName);

    await command.execute(interaction, {
      SUBMIT_SHEET_ID,
      MAIN_SHEET_ID
    });

  } catch (err) {
    console.error("❌ Interaction error:", err);
  }

});

// ================= HEALTH SERVER =================

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