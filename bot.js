console.log("=== BOT STARTING ===");

// ================= CORE =================

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const http = require("http");

// ================= ERROR HANDLING =================

process.on("unhandledRejection", error => {
  console.error("❌ Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("❌ Uncaught exception:", error);
});

// ================= ENV =================

const SUBMIT_SHEET_ID = process.env.SUBMIT_SHEET_ID;
const MAIN_SHEET_ID = process.env.MAIN_SHEET_ID;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

console.log("ENV CHECK:", {
  DISCORD_TOKEN: !!DISCORD_TOKEN,
  GOOGLE: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
  MAIN: !!MAIN_SHEET_ID,
  SUBMIT: !!SUBMIT_SHEET_ID
});

// ================= SAFE IMPORTS =================

let verifyCommand = null;
let handleVerify = null;
let handleWelcome = null;

try {

  ({
    verifyCommand,
    handleVerify,
    handleWelcome
  } = require("./index"));

  console.log("✅ welcome module loaded");

} catch (err) {

  console.error(
    "❌ Failed to load welcome module:"
  );

  console.error(err);

}

// ================= EVENT BANS =================

let eventBanCommand = null;
let handleEventBan = null;

try {

  ({
    eventBanCommand,
    handleEventBan
  } = require("./event-bans/eventBans"));

  console.log("✅ event bans module loaded");

  console.log("EVENT BAN DEBUG:", {
    exists: !!eventBanCommand,
    hasToJSON:
      typeof eventBanCommand?.toJSON === "function"
  });

} catch (err) {

  console.error(
    "❌ Failed to load event bans module:"
  );

  console.error(err);

}

// ================= BAN CHECKER =================

let startBanExpiryChecker = null;

try {

  ({ startBanExpiryChecker } =
    require("./banExpiryChecker"));

  console.log("✅ banExpiryChecker loaded");

} catch (err) {

  console.error(
    "⚠️ banExpiryChecker not loaded:"
  );

  console.error(err);

}

// ================= DM =================

let dm = null;

try {

  dm = require("./commands/dm");

  console.log("✅ DM module loaded");

} catch (err) {

  console.error(
    "⚠️ DM module not loaded:"
  );

  console.error(err);

}

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

console.log("=== CLIENT CREATED ===");

// ================= LOAD COMMANDS =================

const commandsPath =
  path.join(__dirname, "commands");

let commandFiles = [];

try {

  commandFiles = fs
    .readdirSync(commandsPath)
    .filter(file => file.endsWith(".js"));

} catch (err) {

  console.error(
    "❌ Failed to read commands folder:"
  );

  console.error(err);

}

for (const file of commandFiles) {

  try {

    const command =
      require(`./commands/${file}`);

    if (!command?.data || !command?.execute) {

      console.log(
        `⚠️ Skipped invalid command file: ${file}`
      );

      continue;

    }

    client.commands.set(
      command.data.name,
      command
    );

    console.log(
      `✅ Loaded command: ${command.data.name}`
    );

  } catch (err) {

    console.error(
      `❌ Error loading command file: ${file}`
    );

    console.error(err);

  }

}

// ================= READY =================

client.once("clientReady", async () => {

  console.log(
    `🚀 Logged in as ${client.user.tag}`
  );

  // ================= BAN CHECKER =================

  if (startBanExpiryChecker) {

    try {

      startBanExpiryChecker(client);

      console.log(
        "✅ Ban expiry checker started"
      );

    } catch (err) {

      console.error(
        "❌ Ban checker failed:"
      );

      console.error(err);

    }

  }

  // ================= REGISTER SLASH COMMANDS =================

  try {

    const commands = [];

    if (verifyCommand) {
      commands.push(verifyCommand.toJSON());
    }

    if (eventBanCommand) {
      commands.push(eventBanCommand.toJSON());
    }

    if (dm?.data) {
      commands.push(dm.data.toJSON());
    }

    const rest = new REST({ version: "10" })
      .setToken(DISCORD_TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );

    console.log(
      `✅ Registered ${commands.length} slash commands`
    );

  } catch (err) {

    console.error(
      "❌ Failed to register slash commands:"
    );

    console.error(err);

  }

});

// ================= INTERACTIONS =================

client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {

    // ================= VERIFY =================

    if (interaction.commandName === "verify") {

      if (!handleVerify) {
        return interaction.reply({
          content: "Verify system unavailable.",
          ephemeral: true
        });
      }

      return handleVerify(interaction);

    }

    // ================= EVENT BAN =================

    if (interaction.commandName === "eventban") {

      if (!handleEventBan) {
        return interaction.reply({
          content: "Event ban system unavailable.",
          ephemeral: true
        });
      }

      return handleEventBan(interaction);

    }

    // ================= DM =================

    if (
      interaction.commandName === dm?.data?.name
    ) {

      return dm.execute(interaction);

    }

    // ================= COMMANDS FOLDER =================

    const command = client.commands.get(
      interaction.commandName
    );

    if (!command) {
      return;
    }

    await command.execute(interaction);

  } catch (err) {

    console.error(
      "❌ interactionCreate error:"
    );

    console.error(err);

    try {

      if (interaction.deferred || interaction.replied) {

        await interaction.followUp({
          content: "An error occurred.",
          ephemeral: true
        });

      } else {

        await interaction.reply({
          content: "An error occurred.",
          ephemeral: true
        });

      }

    } catch (replyErr) {

      console.error(replyErr);

    }

  }

});

// ================= MEMBER JOIN =================

client.on("guildMemberAdd", async member => {

  console.log(
    `👋 New member joined: ${member.user.tag}`
  );

  try {

    if (handleWelcome) {

      await handleWelcome(member);

      console.log(
        `✅ Welcome handled for ${member.user.tag}`
      );

    } else {

      console.log(
        "⚠️ handleWelcome missing"
      );

    }

  } catch (err) {

    console.error(
      "❌ guildMemberAdd error:"
    );

    console.error(err);

  }

});

// ================= HEALTH SERVER =================

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {

    res.writeHead(200, {
      "Content-Type": "text/plain"
    });

    res.end("Bot is alive.");

  })
  .listen(PORT, () => {

    console.log(
      `🌐 Health server running on ${PORT}`
    );

  });

// ================= LOGIN =================

client.login(DISCORD_TOKEN)
  .then(() => {

    console.log("✅ Login successful");

  })
  .catch(err => {

    console.error("❌ Login failed:");
    console.error(err);

  });