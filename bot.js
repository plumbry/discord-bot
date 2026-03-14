const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle
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

// ================= GAMECALL STATE =================

const gamecallModule = require("./commands/gamecall");
const activeCalls = gamecallModule.activeCalls || new Map();

// ================= CONSTANTS =================

const GUILD_ID = "1371615693392576580";
const YUNITE_LOG_CHANNEL = "1371615781393137788";
const BOT_LOG_CHANNEL = "1471082166535454780";

const DROP_MAP_COOLDOWN = 5 * 60 * 1000;
let lastDropmapClose = 0;

const ACTIVITY_WINDOW = 15 * 60 * 1000;

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

// ================= LOAD COMMAND FILES =================

const commandsPath = path.join(__dirname, "commands");

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith(".js"));

for (const file of commandFiles) {

  try {

    const command = require(`./commands/${file}`);

    if (!command?.data || !command?.execute) {
      console.log(`Skipping invalid command: ${file}`);
      continue;
    }

    client.commands.set(command.data.name, command);

  } catch (err) {

    console.error(`Error loading command: ${file}`);
    console.error(err);

  }

}

// ================= DROP MAP FUNCTION =================

async function closeDropmap(guild) {

  const logChannel = guild.channels.cache.get(BOT_LOG_CHANNEL);

  const nowCooldown = Date.now();

  if (nowCooldown - lastDropmapClose < DROP_MAP_COOLDOWN) {

    console.log("Dropmap closure skipped (cooldown active)");

    if (logChannel) {
      logChannel.send("⚠️ Dropmap closure skipped — cooldown active.");
    }

    return;
  }

  let activeCategory = null;
  let newestMessageTime = 0;

  const dropmapChannels = guild.channels.cache.filter(
    c => c.isTextBased() && c.name.toLowerCase().includes("dropmap")
  );

  const categories = new Set();

  for (const channel of dropmapChannels.values()) {
    if (channel.parent) categories.add(channel.parent);
  }

  for (const category of categories) {

    const chatChannels = guild.channels.cache.filter(
      c =>
        c.parentId === category.id &&
        c.isTextBased() &&
        c.name.toLowerCase().includes("chat")
    );

    for (const channel of chatChannels.values()) {

      try {

        const messages = await channel.messages.fetch({ limit: 1 });
        const lastMessage = messages.first();

        if (!lastMessage) continue;

        const age = Date.now() - lastMessage.createdTimestamp;

        if (age < ACTIVITY_WINDOW) {

          if (lastMessage.createdTimestamp > newestMessageTime) {
            newestMessageTime = lastMessage.createdTimestamp;
            activeCategory = category;
          }

        }

      } catch {
        continue;
      }

    }

  }

  if (!activeCategory) {

    console.log("No active category detected.");

    if (logChannel) {
      logChannel.send("⚠️ Dropmap closure failed — no active category detected.");
    }

    return;
  }

  const dropmapChannel = guild.channels.cache.find(c =>
    c.parentId === activeCategory.id &&
    c.name.toLowerCase().includes("dropmap")
  );

  if (!dropmapChannel) {

    console.log("No dropmap channel found in:", activeCategory.name);

    if (logChannel) {
      logChannel.send(`⚠️ Dropmap closure failed — no dropmap channel in **${activeCategory.name}**.`);
    }

    return;
  }

  lastDropmapClose = nowCooldown;

  console.log("Closing dropmap in:", dropmapChannel.name);

  await dropmapChannel.send(
    "🚫 **DROPMAP CLOSED — CHANGES WILL COUNT FOR NEXT GAME**"
  );

  if (logChannel) {
    logChannel.send(`✅ Dropmap closed in **#${dropmapChannel.name}** (${activeCategory.name})`);
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

  if (dm.startDMScheduler) {
    dm.startDMScheduler(client);
  }

});

// ================= DISCORD LOG TRIGGER =================

client.on("messageCreate", async message => {

  if (message.channel.id !== YUNITE_LOG_CHANNEL) return;

  const content = message.content.toLowerCase();

  if (
    !content.includes("matches are running") &&
    !content.includes("test dropmap")
  ) return;

  closeDropmap(message.guild);

});

// ================= INTERACTIONS =================

client.on("interactionCreate", async interaction => {

  // SLASH COMMANDS

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
      console.error(error);
    }

  }

  // ================= STAFF PANEL BUTTONS =================

  if (interaction.isButton()) {

    const call = activeCalls.get(interaction.channel.id);

    if (!call) {
      return interaction.reply({
        content: "No active game call in this channel.",
        ephemeral: true
      });
    }

    if (interaction.customId === "staff_cancel_game") {

      clearTimeout(call.t1);
      clearTimeout(call.t2);

      activeCalls.delete(interaction.channel.id);

      await interaction.reply({
        content: "❌ Game call cancelled.",
        ephemeral: true
      });

      return;

    }

    if (interaction.customId === "staff_stop_followups") {

      clearTimeout(call.t1);
      clearTimeout(call.t2);

      await interaction.reply({
        content: "⛔ Follow-ups stopped.",
        ephemeral: true
      });

      return;

    }

    if (interaction.customId === "staff_lock_chat") {

      const everyone = interaction.guild.roles.everyone;

      await interaction.channel.permissionOverwrites.edit(everyone, {
        SendMessages: false
      });

      await interaction.reply({
        content: "🔒 Chat locked.",
        ephemeral: true
      });

      return;

    }

    if (interaction.customId === "staff_check_streams") {

      await interaction.reply({
        content: "Running stream check...",
        ephemeral: true
      });

      const command = client.commands.get("teamsstreamcheck");

      if (command) {
        command.execute(interaction);
      }

      return;

    }

  }

});

// ================= MEMBER JOIN =================

client.on("guildMemberAdd", handleWelcome);

client.login(process.env.DISCORD_TOKEN);