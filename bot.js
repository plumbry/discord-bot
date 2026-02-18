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

// Event bans
const {
  eventBanCommand,
  handleEventBan,
  recentBanCommand,
  handleRecentBan,
  myBanCommand,
  handleMyBan
} = require("./event bans/eventBans");

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
        myBanCommand.toJSON()
      ]
    }
  );

  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// ================= MEMBER JOIN =================
client.on("guildMemberAdd", handleWelcome);

// ================= INTERACTIONS =================
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // ALWAYS defer so we never time out
  await interaction.deferReply({ ephemeral: false });

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

  return interaction.editReply("Unknown command.");
});

client.login(process.env.DISCORD_TOKEN);
