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
  handleEventBan
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
        eventBanCommand.toJSON()
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

  await interaction.deferReply({ ephemeral: false });

  if (interaction.commandName === "verify") {
    return handleVerify(interaction);
  }

  if (interaction.commandName === "eventban") {
    return handleEventBan(interaction);
  }

  return interaction.editReply("Unknown command.");
});

client.login(process.env.DISCORD_TOKEN);
