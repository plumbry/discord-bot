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
const axios = require("axios");
const WebSocket = require("ws");

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
const YUNITE_API_KEY = process.env.YUNITE_API_KEY;
const YUNITE_GUILD_ID = "1371615693392576580";

const DROP_MAP_COOLDOWN = 5 * 60 * 1000;
let lastDropmapClose = 0;

const ACTIVITY_WINDOW = 15 * 60 * 1000;

// ================= PANEL UPDATE =================

async function updatePanel(guild, channelId) {

  const call = activeCalls.get(channelId);
  if (!call || !call.panelMessageId) return;

  const logChannel = guild.channels.cache.get(BOT_LOG_CHANNEL);
  if (!logChannel) return;

  try {

    const panel = await logChannel.messages.fetch(call.panelMessageId);

    await panel.edit({
      content:
`🎮 GAME ${call.gameNumber} CONTROL PANEL

Status: ${call.status}
Chat: ${call.chat}
Streams: ${call.streams}
Followups: ${call.followups}`
    });

  } catch (err) {
    console.error("Panel update failed:", err);
  }

}

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

async function closeDropmap(guild) {

  const logChannel = guild.channels.cache.get(BOT_LOG_CHANNEL);

  const nowCooldown = Date.now();

  if (nowCooldown - lastDropmapClose < DROP_MAP_COOLDOWN) {

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

  if (!activeCategory) return;

  const dropmapChannel = guild.channels.cache.find(c =>
    c.parentId === activeCategory.id &&
    c.name.toLowerCase().includes("dropmap")
  );

  if (!dropmapChannel) return;

  lastDropmapClose = nowCooldown;

  await dropmapChannel.send(
    "🚫 **DROPMAP CLOSED — CHANGES WILL COUNT FOR NEXT GAME**"
  );

  if (logChannel) {
    logChannel.send(`✅ Dropmap closed in **#${dropmapChannel.name}** (${activeCategory.name})`);
  }

}

async function startYuniteStream() {

  try {

    const res = await axios.get(
      "https://yunite.xyz/api/v3/websocket-token",
      {
        headers: {
          "Y-Api-Token": YUNITE_API_KEY
        }
      }
    );

    const token = res.data;

    const ws = new WebSocket(
      `wss://yunite.xyz/api/v3/guild/${YUNITE_GUILD_ID}/customs/stream?token=${token}`
    );

    ws.on("open", () => {
      console.log("Connected to Yunite customs stream");
    });

    ws.on("message", async (msg) => {

      const payload = JSON.parse(msg);

      if (!payload?.data) return;

      const state = payload.data.state;

      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) return;

      const logChannel = guild.channels.cache.get(BOT_LOG_CHANNEL);

      if (state === "STARTED") {
        console.log("Yunite: match started");
        await closeDropmap(guild);
      }

      if (state === "FINISHED") {
        console.log("Yunite: match finished");
        if (logChannel) {
          logChannel.send("✅ Yunite detected match finished.");
        }
      }

    });

    ws.on("close", () => {
      console.log("Yunite stream closed — reconnecting");
      setTimeout(startYuniteStream, 10000);
    });

    ws.on("error", err => {
      console.log("Yunite stream error:", err.message);
    });

  } catch (err) {

    console.error("Yunite connection failed:", err.response?.data || err.message);

    setTimeout(startYuniteStream, 15000);

  }

}

// ================= SAFE YUNITE SOCKET (ADDED) =================

let yuniteSocket = null;
let yuniteReconnectTimer = null;
let yuniteReconnectDelay = 10000;

async function startYuniteStreamSafe() {

  try {

    if (yuniteSocket) {
      console.log("Yunite socket already active");
      return;
    }

    console.log("Requesting Yunite websocket token...");

    const res = await axios.get(
      "https://yunite.xyz/api/v3/websocket-token",
      {
        headers: {
          "Y-Api-Token": YUNITE_API_KEY
        },
        timeout: 10000
      }
    );

    const token = res.data;

    console.log("Connecting to Yunite stream...");

    yuniteSocket = new WebSocket(
      `wss://yunite.xyz/api/v3/guild/${YUNITE_GUILD_ID}/customs/stream?token=${token}`
    );

    yuniteSocket.on("open", () => {

      console.log("✅ Yunite stream connected");
      yuniteReconnectDelay = 10000;

    });

    yuniteSocket.on("message", async (msg) => {

      try {

        const payload = JSON.parse(msg);

        if (!payload?.data) return;

        const state = payload.data.state;

        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return;

        const logChannel = guild.channels.cache.get(BOT_LOG_CHANNEL);

        if (state === "STARTED") {

          console.log("🎮 Yunite: match started");

          await closeDropmap(guild);

          if (logChannel) {
            logChannel.send("🎮 Yunite detected **match start**");
          }

        }

        if (state === "FINISHED") {

          console.log("🏁 Yunite: match finished");

          if (logChannel) {
            logChannel.send("🏁 Yunite detected **match finished**");
          }

        }

      } catch (err) {

        console.log("Yunite message parse error:", err.message);

      }

    });

    yuniteSocket.on("close", () => {

      console.log("⚠️ Yunite socket closed");

      yuniteSocket = null;

      scheduleYuniteReconnect();

    });

    yuniteSocket.on("error", (err) => {

      console.log("Yunite socket error:", err.message);

      if (yuniteSocket) {
        yuniteSocket.terminate();
        yuniteSocket = null;
      }

    });

  } catch (err) {

    console.log(
      "Yunite connection failed:",
      err.response?.data || err.message
    );

    scheduleYuniteReconnect();

  }

}

function scheduleYuniteReconnect() {

  if (yuniteReconnectTimer) return;

  console.log(`Reconnecting Yunite in ${yuniteReconnectDelay / 1000}s`);

  yuniteReconnectTimer = setTimeout(() => {

    yuniteReconnectTimer = null;

    startYuniteStreamSafe();

    yuniteReconnectDelay = Math.min(yuniteReconnectDelay * 2, 60000);

  }, yuniteReconnectDelay);

}

// Override original Yunite function safely
startYuniteStream = startYuniteStreamSafe;


// ================= READY =================

client.once("ready", async () => {

  console.log(`Logged in as ${client.user.tag}`);
  
  startYuniteStream();

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

// ================= DROP MAP TRIGGER =================

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

  // ===== SLASH COMMANDS =====

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

  // ===== STAFF PANEL BUTTONS =====

  if (interaction.isButton()) {

    if (!interaction.customId.startsWith("staff_")) return;

    const parts = interaction.customId.split("_");
    const action = parts.slice(0,3).join("_");
    const channelId = parts[3];

    const call = activeCalls.get(channelId);
    const gameChannel = interaction.guild.channels.cache.get(channelId);

    if (!call || !gameChannel) {
      return interaction.reply({
        content: "⚠️ This game panel is no longer active.",
        ephemeral: true
      });
    }

    // ===== CANCEL GAME =====

    if (action === "staff_cancel_game") {

      clearTimeout(call.t1);
      clearTimeout(call.t2);

      call.status = "Cancelled";

      const logChannel = interaction.guild.channels.cache.get(BOT_LOG_CHANNEL);

      if (call.panelMessageId && logChannel) {

        const panel = await logChannel.messages.fetch(call.panelMessageId);

        const disabledRow = new ActionRowBuilder().addComponents(

          new ButtonBuilder().setCustomId("d1").setLabel("Cancel Game").setStyle(ButtonStyle.Danger).setDisabled(true),
          new ButtonBuilder().setCustomId("d2").setLabel("Stop Followups").setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId("d3").setLabel("Lock Chat").setStyle(ButtonStyle.Secondary).setDisabled(true),
          new ButtonBuilder().setCustomId("d4").setLabel("Unlock Chat").setStyle(ButtonStyle.Success).setDisabled(true),
          new ButtonBuilder().setCustomId("d5").setLabel("Check Streams").setStyle(ButtonStyle.Primary).setDisabled(true)

        );

        await panel.edit({

          content:
`🎮 GAME ${call.gameNumber} CONTROL PANEL

Status: Cancelled
Chat: ${call.chat}
Streams: ${call.streams}
Followups: ${call.followups}`,

          components:[disabledRow]

        });

      }

      activeCalls.delete(channelId);

      await gameChannel.send("❌ **Game call cancelled by staff.**");

      return interaction.reply({
        content: "Game cancelled.",
        ephemeral: true
      });

    }

    // ===== STOP FOLLOWUPS =====

    if (action === "staff_stop_followups") {

      clearTimeout(call.t1);
      clearTimeout(call.t2);

      call.followups = "Stopped";

      await updatePanel(interaction.guild, channelId);

      return interaction.reply({
        content: "Follow-ups stopped.",
        ephemeral: true
      });

    }

    // ===== LOCK CHAT =====

    if (action === "staff_lock_chat") {

      const chatChannel = interaction.guild.channels.cache.find(
        c =>
          c.parentId === gameChannel.parentId &&
          c.name.toLowerCase().includes("chat")
      );

      await chatChannel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: false }
      );

      call.chat = "Locked";

      await updatePanel(interaction.guild, channelId);

      return interaction.reply({
        content: `🔒 Chat locked in ${chatChannel}.`,
        ephemeral: true
      });

    }

    // ===== UNLOCK CHAT =====

    if (action === "staff_unlock_chat") {

      const chatChannel = interaction.guild.channels.cache.find(
        c =>
          c.parentId === gameChannel.parentId &&
          c.name.toLowerCase().includes("chat")
      );

      await chatChannel.permissionOverwrites.edit(
        interaction.guild.roles.everyone,
        { SendMessages: null }
      );

      call.chat = "Open";

      await updatePanel(interaction.guild, channelId);

      return interaction.reply({
        content: `🔓 Chat unlocked in ${chatChannel}.`,
        ephemeral: true
      });

    }

    // ===== CHECK STREAMS =====

    if (action === "staff_check_streams") {

      const streamChannel = interaction.guild.channels.cache.find(
        c =>
          c.parentId === gameChannel.parentId &&
          c.name.toLowerCase() === "twitch-streams"
      );

      const command = client.commands.get("checklive");

      await command.execute({
        ...interaction,
        channel: streamChannel
      });

      call.streams = "Checked";

      await updatePanel(interaction.guild, channelId);

      return interaction.reply({
        content: `Running stream check in ${streamChannel}`,
        ephemeral: true
      });

    }

  }

});

// ================= MEMBER JOIN =================

client.on("guildMemberAdd", handleWelcome);

client.login(process.env.DISCORD_TOKEN);