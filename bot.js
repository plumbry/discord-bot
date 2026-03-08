const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ================= ERROR HANDLING =================
process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

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
  handleMyBan
} = require("./event bans/eventBans");

// ================= DM SYSTEM =================
const dm = require("./commands/dm");

// ================= CONSTANTS =================
const GUILD_ID = "1371615693392576580";
const HASH_FILE = "./commandHash.json";

// ================= DISCORD CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
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

    if (!command.data || !command.execute) {
      console.log(`⚠️ Command missing data or execute: ${file}`);
      continue;
    }

    client.commands.set(command.data.name, command);
    console.log(`✅ Loaded command: ${command.data.name}`);

  } catch (err) {

    console.error(`❌ Failed to load command: ${file}`);
    console.error(err);

  }

}

// ================= READY =================
client.once("ready", async () => {

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  const commands = [
    verifyCommand,
    eventBanCommand,
    recentBanCommand,
    myBanCommand,
    dm.dmCommand
  ];

  for (const command of client.commands.values()) {
    commands.push(command.data);
  }

  const commandJSON = commands.map(c => c.toJSON());

  const newHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(commandJSON))
    .digest("hex");

  let oldHash = null;

  if (fs.existsSync(HASH_FILE)) {
    oldHash = JSON.parse(fs.readFileSync(HASH_FILE)).hash;
  }

  if (newHash !== oldHash) {

    console.log("🔄 Command changes detected. Updating Discord commands...");

    try {

      await rest.put(
        Routes.applicationGuildCommands(client.user.id, GUILD_ID),
        { body: commandJSON }
      );

      fs.writeFileSync(
        HASH_FILE,
        JSON.stringify({ hash: newHash }, null, 2)
      );

      console.log("✅ Slash commands updated");

    } catch (err) {

      console.error("❌ Failed to update slash commands");
      console.error(err);

    }

  } else {

    console.log("⚡ Commands unchanged. Skipping Discord update.");

  }

  console.log(`🤖 Logged in as ${client.user.tag}`);

  if (dm.startDMScheduler) {
    dm.startDMScheduler(client);
  }

});

// ================= DM BLOCK =================
client.on("messageCreate", async message => {

  if (message.author.bot) return;

  if (!message.guild) {

    try {

      await message.reply(
        "❌ This bot does not accept direct messages. Please contact a server moderator instead."
      );

    } catch (err) {

      console.error("Failed to reply to DM:", err);

    }

  }

});

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {

  if (interaction.isChatInputCommand()) {

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

    if (interaction.commandName === "dm" && dm.handleDM)
      return dm.handleDM(interaction);

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {

      await command.execute(interaction);

    } catch (error) {

      console.error(`Command error (${interaction.commandName}):`, error);

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

  }

  if (interaction.isButton() && dm.handleDMButton) {
    return dm.handleDMButton(interaction);
  }

});

// ================= WELCOME =================
client.on("guildMemberAdd", handleWelcome);

// ================= LOGIN =================
client.login(process.env.DISCORD_TOKEN);