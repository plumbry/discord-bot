require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ChannelType
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ================= ERROR HANDLING =================

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

// ================= IMPORT COMMAND MODULES =================

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

// ================= CONSTANTS =================

const GUILD_ID = "1371615693392576580";
const YUNITE_LOG_CHANNEL = "1371615781393137788";

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
  console.log(`Logged in as ${client.user.tag}`);

  startBanExpiryChecker(client);

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  const commands = [
    verifyCommand,
    eventBanCommand,
    recentBanCommand,
    myBanCommand
  ];

  // include dynamic commands
  for (const command of client.commands.values()) {
    commands.push(command.data);
  }

  const commandJSON = commands
    .filter(c => c && typeof c.toJSON === "function")
    .map(c => c.toJSON());

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commandJSON }
  );

  console.log("✅ Commands registered");

  if (dm.startDMScheduler) {
    dm.startDMScheduler(client);
  }
});

// ================= MEMBER JOIN =================

client.on("guildMemberAdd", async (member) => {
  await handleWelcome(member);
});

// ================= INTERACTIONS =================

client.on("interactionCreate", async (interaction) => {

  // ===== BUTTON HANDLING (for verify buttons etc.) =====
  if (interaction.isButton()) {
    try {
      await handleVerify(interaction, client);
    } catch (err) {
      console.error("❌ Button error:", err);
    }
    return;
  }

  // ===== SLASH COMMANDS =====
  if (!interaction.isChatInputCommand()) return;

  try {
    // 🔥 CRITICAL FIX — route verify manually
    if (interaction.commandName === "verify") {
      return handleVerify(interaction, client);
    }

    if (interaction.commandName === "eventban") {
      return handleEventBan(interaction);
    }

    if (interaction.commandName === "recentban") {
      return handleRecentBan(interaction);
    }

    if (interaction.commandName === "myban") {
      await interaction.deferReply({ ephemeral: true });
      return handleMyBan(interaction);
    }

    if (interaction.commandName === "dm" && dm.handleDM) {
      return dm.handleDM(interaction);
    }

    // ===== COMMAND MAP =====
    const command = client.commands.get(interaction.commandName);

    if (!command) {
      console.log("❌ Command not found:", interaction.commandName);
      return;
    }

    await command.execute(interaction, client);

  } catch (error) {
    console.error(`❌ Interaction error:`, error);

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
  }
});

// ================= DROPMAP AUTO CLOSE =================

client.on("messageCreate", async (message) => {
  try {
    if (message.channel.id !== YUNITE_LOG_CHANNEL) return;
    if (!message.author.bot) return;

    const embed = message.embeds?.[0];
    if (!embed) return;

    const title = embed.title?.toLowerCase() || "";
    if (!title.includes("custom game matchmaking result")) return;

    console.log("🎯 Matchmaking result detected");

    const channels = await message.guild.channels.fetch();

    // STEP 1: Find category that has a "chat" channel (active event)
    let activeCategory = null;

    for (const channel of channels.values()) {
      if (!channel.isTextBased()) continue;

      const name = channel.name.toLowerCase();

      if (name.includes("chat") && channel.parentId) {
        const parent = channels.get(channel.parentId);
        if (parent && parent.type === ChannelType.GuildCategory) {
          activeCategory = parent;
          break;
        }
      }
    }

    if (!activeCategory) {
      console.log("❌ No active category with chat channel found");
      return;
    }

    console.log("📁 Active category:", activeCategory.name);

    // STEP 2: Find dropmap channel in that category
    const dropmapChannel = channels.find(c =>
      c.parentId === activeCategory.id &&
      c.isTextBased() &&
      c.name.toLowerCase().includes("dropmap")
    );

    if (!dropmapChannel) {
      console.log("❌ Dropmap channel not found in:", activeCategory.name);
      return;
    }

    console.log("📍 Posting to:", dropmapChannel.name);

    await dropmapChannel.send("🚫 DROPMAP CLOSED UNTIL NEXT GAME");

  } catch (err) {
    console.error("❌ Dropmap auto-close error:", err);
  }
});

// ================= LOGIN =================

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("Bot login successful"))
  .catch(err => console.error("Login error:", err));