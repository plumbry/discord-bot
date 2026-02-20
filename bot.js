const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require("discord.js");

// ================= DM SYSTEM =================
const dm = require("./commands/dm");

// ================= WHOIS =================
const whois = require("./commands/whois");

// ================= CHAT PERMS =================
const chatperms = require("./commands/chatperms");

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

// ================= CONSTANTS =================
const GUILD_ID = "1371615693392576580";

// ================= DISCORD CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

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

  if (dm.dmCommand) commands.push(dm.dmCommand);
  if (whois?.data) commands.push(whois.data);
  if (chatperms?.data) commands.push(chatperms.data);

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands.map(c => c.toJSON()) }
  );

  console.log(`🤖 Logged in as ${client.user.tag}`);

  if (dm.startDMScheduler) {
    dm.startDMScheduler(client);
  }
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "verify") return handleVerify(interaction);
    if (interaction.commandName === "eventban") return handleEventBan(interaction);
    if (interaction.commandName === "recentban") return handleRecentBan(interaction);
    if (interaction.commandName === "myban") {
      await interaction.deferReply({ ephemeral: true });
      return handleMyBan(interaction);
    }
    if (interaction.commandName === "dm" && dm.handleDM) {
      return dm.handleDM(interaction);
    }
    if (interaction.commandName === "whois") {
      return whois.execute(interaction);
    }
    if (interaction.commandName === "chatperms") {
      return chatperms.execute(interaction);
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