const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");

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

// ================= COMMAND COLLECTION =================
client.commands = new Map();

// ================= LOAD COMMAND FILES =================
const commandsPath = path.join(__dirname, "commands");

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith(".js"));

for (const file of commandFiles) {

  const command = require(`./commands/${file}`);

  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
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
    myBanCommand
  ];

  // add dynamically loaded commands
  for (const command of client.commands.values()) {
    commands.push(command.data);
  }

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands.map(c => c.toJSON()) }
  );

  console.log(`🤖 Logged in as ${client.user.tag}`);

  if (dm.startDMScheduler) {
    dm.startDMScheduler(client);
  }

});

// ================= DM BLOCK =================
client.on("messageCreate", async message => {

  if (message.author.bot) return;

  // If message is a DM
  if (!message.guild) {

    try {
      await message.reply(
        "❌ This bot does not accept direct messages. Please contact a server moderator instead."
      );
    } catch (err) {
      console.error("Failed to reply to DM:", err);
    }

    return;

  }

});

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {

  if (interaction.isChatInputCommand()) {

    // ===== SPECIAL COMMANDS =====

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

    // ===== DYNAMIC COMMANDS =====

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {

      await command.execute(interaction);

    } catch (error) {

      console.error(error);

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

  // ===== BUTTON HANDLING =====

  if (interaction.isButton() && dm.handleDMButton) {
    return dm.handleDMButton(interaction);
  }

});

// ================= WELCOME =================
client.on("guildMemberAdd", handleWelcome);

// ================= LOGIN =================
client.login(process.env.DISCORD_TOKEN);