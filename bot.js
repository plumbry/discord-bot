const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
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
let girlCacheReady = false;

function cleanId(value) {
  if (!value) return null;

  return String(value)
    .normalize("NFKC")
    .replace(/[^\d]/g, "")
    .trim();
}

async function loadGirlCache() {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${GIRL_ROLE_SHEET}!A:A`
    });

    girlCache = new Set(
      (res.data.values || [])
        .map(r => cleanId(r[0]))
        .filter(id => id && id.length >= 17)
    );

    girlCacheReady = true;

    console.log("✅ Girl cache loaded:", girlCache.size);
  } catch (err) {
    console.error("❌ Failed to load Girl Role cache:", err);
  }
}

async function addGirlVerified(user) {
  const id = cleanId(user.id);

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

    console.log("✅ Added to sheet:", user.tag);
  } catch (err) {
    console.error("❌ SHEETS ERROR:", err);
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

// ================= CONSTANTS =================

const GUILD_ID = "1371615693392576580";
const YUNITE_LOG_CHANNEL = "1371615781393137788";

const DROP_MAP_COOLDOWN = 5 * 60 * 1000;
let lastDropmapClose = 0;

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

// ================= MEMBER JOIN =================

client.on("guildMemberAdd", async (member) => {
  console.log("👋 MEMBER JOIN:", member.user.tag);

  await handleWelcome(member);

  try {
    const id = cleanId(member.id);

    if (!girlCacheReady) {
      await loadGirlCache();
    }

    if (girlCache.has(id)) {
      const role = member.guild.roles.cache.get(ROLE_ID);

      if (role) {
        await member.roles.add(role);
        console.log("✅ Girl role reapplied to", member.user.tag);
      }
    }
  } catch (err) {
    console.error("❌ Girl role reassign error:", err);
  }
});

// ================= ROLE TRACKING =================

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

// ================= COMMAND HANDLER (FIXED) =================

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.log("❌ Command not found:", interaction.commandName);
    return;
  }

  try {
    await command.execute(interaction, client);
  } catch (error) {
    console.error(`❌ Error executing ${interaction.commandName}:`, error);

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

// ================= LOGIN =================

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("Bot login successful"))
  .catch(err => console.error("Login error:", err));
