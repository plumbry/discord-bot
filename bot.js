const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
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

// ===== CACHE =====
let girlCache = new Set();

async function loadGirlCache() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${GIRL_ROLE_SHEET}!A:A`
  });

  girlCache = new Set((res.data.values || []).map(r => r[0]));
  console.log("Girl cache loaded:", girlCache.size);
}

function isGirlVerified(userId) {
  return girlCache.has(userId);
}

async function addGirlVerified(user) {

  if (girlCache.has(user.id)) return;

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${GIRL_ROLE_SHEET}!A:B`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[user.id, user.tag]]
      }
    });

    girlCache.add(user.id);

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

// ================= DROP MAP FUNCTION =================
// (unchanged)

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

  // ===== GIRL ROLE INIT + BATCH BACKFILL =====
  const guild = client.guilds.cache.get(GUILD_ID);

  await guild.members.fetch();
  await loadGirlCache();

  const role = guild.roles.cache.get(ROLE_ID);

  console.log("Backfilling Girl Role...");
  console.log("Role members count:", role.members.size);

  const newRows = [];

  for (const member of role.members.values()) {
    if (!girlCache.has(member.id)) {
      newRows.push([member.id, member.user.tag]);
      girlCache.add(member.id);
    }
  }

  console.log("New users to add:", newRows.length);

  if (newRows.length > 0) {
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${GIRL_ROLE_SHEET}!A:B`,
        valueInputOption: "RAW",
        requestBody: {
          values: newRows
        }
      });

      console.log("Batch write successful.");
    } catch (err) {
      console.error("BATCH WRITE ERROR:", err);
    }
  }

  console.log("Backfill complete.");
  // ===== END BACKFILL =====

});

// ================= MESSAGE CREATE =================
// (unchanged)

// ================= INTERACTIONS =================
// (unchanged)

// ===== GIRL ROLE TRACKING =====
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
// ===== END TRACKING =====


// ================= MEMBER JOIN =================

client.on("guildMemberAdd", async (member) => {

  await handleWelcome(member);

  try {

    if (isGirlVerified(member.id)) {
      const role = member.guild.roles.cache.get(ROLE_ID);
      if (role) {
        await member.roles.add(role);
      }
    }

  } catch (err) {
    console.error("Girl role reassign error:", err);
  }

});

client.login(process.env.DISCORD_TOKEN);