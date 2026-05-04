```js
console.log("=== BOT STARTING ===");

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

// ================= IMPORT MODULES =================

const {
  verifyCommand,
  handleVerify,
  handleWelcome
} = require("./welcome ping");

const {
  eventBanCommand,
  recentBanCommand,
  myBanCommand,
  handleEventBan,
  handleRecentBan,
  handleMyBan
} = require("./event bans/eventBans");

const { startBanExpiryChecker } = require("./banExpiryChecker");

const dm = require("./commands/dm");

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
    console.error(`Error loading command: ${file}`, err);
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
    eventBanCommand,
    recentBanCommand,
    myBanCommand
  ];

  for (const command of client.commands.values()) {
    commands.push(command.data);
  }

  const commandJSON = commands
    .filter(c => c?.toJSON)
    .map(c => c.toJSON());

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, "1371615693392576580"),
    { body: commandJSON }
  );

  // ✅ DM scheduler uses MAIN sheet
  if (dm.startDMScheduler && MAIN_SHEET_ID) {
    dm.startDMScheduler(client, MAIN_SHEET_ID);
    console.log("✅ DM scheduler started");
  } else {
    console.log("⚠️ DM scheduler disabled");
  }

});

// ================= INTERACTIONS =================

client.on("interactionCreate", async (interaction) => {

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "verify")
    return handleVerify(interaction);

  if (interaction.commandName === "eventban")
    return handleEventBan(interaction);

  if (interaction.commandName === "recentban")
    return handleRecentBan(interaction);

  if (interaction.commandName === "myban") {
    await interaction.deferReply({ ephemeral: true });
    return handleMyBan(interaction);
  }

  const command = client.commands.get(interaction.commandName);

  if (!command) return;

  await command.execute(interaction, {
    SUBMIT_SHEET_ID,
    MAIN_SHEET_ID
  });

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
```
