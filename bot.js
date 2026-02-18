const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const { google } = require("googleapis");

const {
  dmCommand,
  handleDM,
  handleDMButton
} = require("./commands/dm");

// ===== EXISTING MODULES (UNCHANGED) =====
const { verifyCommand, handleVerify, handleWelcome } = require("./welcome ping");
const {
  eventBanCommand,
  recentBanCommand,
  myBanCommand,
  handleEventBan,
  handleRecentBan,
  handleMyBan,
  checkProbationExpiry
} = require("./event bans/eventBans");

const GUILD_ID = "1371615693392576580";
const MOD_CHANNEL_ID = "1471082166535454780";
const SCHEDULED_DMS_SHEET = "Scheduled DMs";

const serviceAccount = JSON.parse(
  Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

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
  startScheduler();
  scheduleDailyProbationCheck(client);
});

// ================= SCHEDULER =================

function startScheduler() {
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
        sentAt,
        ,
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

      await new Promise(r => setTimeout(r, 1200)); // rate limit safety
    }
  }, 30_000);
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

  if (interaction.isButton()) return handleDMButton(interaction);
});

client.on("guildMemberAdd", handleWelcome);

client.login(process.env.DISCORD_TOKEN);
