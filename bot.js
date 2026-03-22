const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ===== GIRL ROLE SYSTEM START =====
const { google } = require("googleapis");

const ROLE_ID = "1371652325629755472";
const GIRL_ROLE_SHEET = "Girl Role";
const SHEET_ID = "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM";

const credentials = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

let girlCache = new Set();

async function loadGirlCache() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${GIRL_ROLE_SHEET}!A:A`
    });

    girlCache = new Set(
      (res.data.values || [])
        .map(r => String(r[0]).trim())
        .filter(Boolean)
    );

    console.log("Girl cache loaded:", girlCache.size);
  } catch (err) {
    console.error("Failed to load Girl Role cache:", err);
  }
}

function isGirlVerified(userId) {
  return girlCache.has(String(userId).trim());
}

async function addGirlVerified(user) {
  const id = String(user.id).trim();

  if (girlCache.has(id)) return;

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${GIRL_ROLE_SHEET}!A:B`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[id, user.tag]]
      }
    });

    girlCache.add(id);
  } catch (err) {
    console.error("SHEETS ERROR:", err);
  }
}
// ===== GIRL ROLE SYSTEM END =====


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

// ================= READY =================

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  startBanExpiryChecker(client);
  await loadGirlCache();

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

// ================= DROP MAP LISTENER =================

client.on("messageCreate", async (message) => {
  try {
    if (message.channel.id !== YUNITE_LOG_CHANNEL) return;
    if (!message.author.bot) return;
    if (!message.embeds?.length) return;

    const embed = message.embeds[0];

    if (!embed.title?.includes("Custom Game Matchmaking Result")) return;

    const description = embed.description || "";

    const tournamentMatch = description.match(/Tournament\s*\n(.+)/i);
    if (!tournamentMatch) return;

    const tournamentName = tournamentMatch[1].trim();

    const keywordMatch = tournamentName.match(
      /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i
    );

    if (!keywordMatch) return;

    const keyword = keywordMatch[1].toLowerCase();

    const guild = message.guild;

    const category = guild.channels.cache.find(
      c =>
        c.type === ChannelType.GuildCategory &&
        c.name.toLowerCase().includes(keyword)
    );

    if (!category) return;

    const channelsInCategory = guild.channels.cache.filter(
      c => c.parentId === category.id
    );

    const now = Date.now();

    let activeChat = null;

    for (const c of channelsInCategory.values()) {
      if (!c.isTextBased()) continue;
      if (!c.name.toLowerCase().includes("chat")) continue;

      const messages = await c.messages.fetch({ limit: 1 }).catch(() => null);
      const lastMessage = messages?.first();

      if (!lastMessage) continue;

      if (now - lastMessage.createdTimestamp < ACTIVITY_WINDOW) {
        activeChat = c;
        break;
      }
    }

    if (!activeChat) return;

    const dropmapChannel = channelsInCategory.find(c =>
      c.isTextBased() &&
      (c.name.toLowerCase().includes("dropmap") ||
        c.name.toLowerCase().includes("drop-map"))
    );

    if (!dropmapChannel) return;

    const nowTime = Date.now();

    if (nowTime - lastDropmapClose < DROP_MAP_COOLDOWN) return;

    lastDropmapClose = nowTime;

    await dropmapChannel.send("DROPMAP CLOSED UNTIL NEXT GAME");

    console.log("Dropmap message sent to:", dropmapChannel.name);

  } catch (err) {
    console.error("Dropmap listener error:", err);
  }
});

// ================= INTERACTIONS =================

client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  try {

    if (interaction.commandName === "verify")
      return await handleVerify(interaction);

    if (interaction.commandName === "eventban")
      return await handleEventBan(interaction);

    if (interaction.commandName === "recentban")
      return await handleRecentBan(interaction);

    if (interaction.commandName === "myban") {
      await interaction.deferReply({ ephemeral: true });
      return await handleMyBan(interaction);
    }

    if (interaction.commandName === "dm" && dm.handleDM)
      return await dm.handleDM(interaction);

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    await command.execute(interaction);

  } catch (error) {

    console.error(`ERROR in command ${interaction.commandName}:`, error);

    try {
      if (interaction.deferred || interaction.replied) {
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
    } catch (err) {
      console.error("Failed to send error reply:", err);
    }

  }

});

// ================= GIRL ROLE TRACKING =================

client.on("guildMemberUpdate", async (oldMember, newMember) => {

  const hadRole = oldMember.roles.cache.has(ROLE_ID);
  const hasRole = newMember.roles.cache.has(ROLE_ID);

  if (!hadRole && hasRole) {
    try {
      await addGirlVerified(newMember.user);
    } catch (err) {
      console.error("Error saving girl role:", err);
    }
  }

});

// ================= MEMBER JOIN =================

client.on("guildMemberAdd", async (member) => {

  await handleWelcome(member);

  try {
    const id = String(member.id).trim();

    if (girlCache.has(id)) {
      const role = member.guild.roles.cache.get(ROLE_ID);
      if (role) {
        await member.roles.add(role);
      }
    }
  } catch (err) {
    console.error("Girl role reassign error:", err);
  }

});

// ================= LOGIN =================

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("Bot login successful"))
  .catch(err => console.error("Login error:", err));