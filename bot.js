const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const { google } = require("googleapis");

// ================= DM SYSTEM =================
const {
  dmCommand,
  handleDM,
  handleDMButton
} = require("./commands/dm");

// ================= VERIFY / WELCOME (UNCHANGED) =================
const {
  verifyCommand,
  handleVerify,
  handleWelcome
} = require("./welcome ping");

// ================= EVENT BANS (UNCHANGED) =================
const {
  eventBanCommand,
  recentBanCommand,
  myBanCommand,
  handleEventBan,
  handleRecentBan,
  handleMyBan,
  checkProbationExpiry
} = require("./event bans/eventBans");

// ================= CONSTANTS =================
const GUILD_ID = "1371615693392576580";
const MOD_CHANNEL_ID = "1471082166535454780";
const SCHEDULED_DMS_SHEET = "Scheduled DMs";

// ================= GOOGLE AUTH =================
const serviceAccount = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// ================= DISCORD CLIENT =================
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
        myBanCommand.toJSON(),
        dmCommand.toJSON()
      ]
    }
  );

  console.log(`🤖 Logged in as ${client.user.tag}`);

  startScheduledDMScheduler();
  scheduleDailyProbationCheck(client);
});

// ================= DM SCHEDULER =================
function startScheduledDMScheduler() {
  setInterval(async () => {
    const now = new Date();

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SCHEDULED_DMS_SHEET}!A2:K`
    });

    const rows = res.data.values || [];

    for (let i = 0; i < rows.length; i++) {
      const [
        jobId,
        ,
        targetId,
        message,
        sendAt,
        status,
        ,
        ,
        ,
        error,
        previewMessageId
      ] = rows[i];

      if (status !== "scheduled") continue;
      if (new Date(sendAt) > now) continue;

      const rowNum = i + 2;

      try {
        const user = await client.users.fetch(targetId);
        await user.send(message);

        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.SPREADSHEET_ID,
          range: `${SCHEDULED_DMS_SHEET}!F${rowNum}:I${rowNum}`,
          valueInputOption: "RAW",
          requestBody: {
            values: [["sent", "", new Date().toISOString(), ""]]
          }
        });

        const channel = await client.channels.fetch(MOD_CHANNEL_ID);
        const msg = await channel.messages.fetch(previewMessageId);
        await msg.edit(
          msg.content +
          `\n\n──────────────\n✅ **DM SENT**\nSent at: ${new Date().toISOString()} UTC`
        );
      } catch (err) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.SPREADSHEET_ID,
          range: `${SCHEDULED_DMS_SHEET}!F${rowNum}:J${rowNum}`,
          valueInputOption: "RAW",
          requestBody: {
            values: [["failed", "", new Date().toISOString(), err.message]]
          }
        });
      }

      // Rate-limit safety
      await new Promise(r => setTimeout(r, 1200));
    }
  }, 30_000);
}

// ================= DAILY PROBATION CHECK =================
function scheduleDailyProbationCheck(client) {
  const now = new Date();
  const next = new Date();
  next.setHours(0, 1, 0, 0);

  if (now >= next) {
    next.setDate(next.getDate() + 1);
  }

  const delay = next.getTime() - now.getTime();

  setTimeout(() => {
    checkProbationExpiry(client);
    setInterval(() => {
      checkProbationExpiry(client);
    }, 24 * 60 * 60 * 1000);
  }, delay);
}

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
    if (interaction.commandName === "dm") return handleDM(interaction);
  }

  if (interaction.isButton()) {
    return handleDMButton(interaction);
  }
});

client.on("guildMemberAdd", handleWelcome);

client.login(process.env.DISCORD_TOKEN);
