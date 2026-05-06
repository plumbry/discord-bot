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

try {

  ({ verifyCommand, handleVerify } =
    require("./welcome-ping"));

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

  // ================= COMMAND REGISTRATION =================

  const rest = new REST({
    version: "10"
  }).setToken(DISCORD_TOKEN);

  const commandJSON = [];

  // ================= COMMANDS FOLDER =================

  for (const command of client.commands.values()) {

    try {

      const json =
        command.data.toJSON();

      commandJSON.push(json);

      console.log(
        `📦 Registering command: ${json.name}`
      );

    } catch (err) {

      console.error(
        `❌ Failed converting command: ${command?.data?.name}`
      );

      console.error(err);

    }

  }

  // ================= VERIFY =================

  if (verifyCommand) {

    try {

      const json =
        verifyCommand.toJSON();

      commandJSON.push(json);

      console.log(
        `📦 Registering command: ${json.name}`
      );

    } catch (err) {

      console.error(
        "❌ Failed converting verify command:"
      );

      console.error(err);

    }

  }

  // ================= EVENT BANS =================

  if (eventBanCommand) {

    try {

      const json =
        eventBanCommand.toJSON();

      commandJSON.push(json);

      console.log(
        `📦 Registering command: ${json.name}`
      );

    } catch (err) {

      console.error(
        "❌ Failed converting event ban command:"
      );

      console.error(err);

    }

  }

  // ================= REGISTER =================

  try {

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        "1371615693392576580"
      ),
      {
        body: commandJSON
      }
    );

    console.log(
      "✅ Slash commands registered"
    );

  } catch (err) {

    console.error(
      "❌ Command registration failed:"
    );

    console.error(err);

  }

  // ================= DM SCHEDULER =================

  if (
    dm?.startDMScheduler &&
    MAIN_SHEET_ID
  ) {

    try {

      dm.startDMScheduler(
        client,
        MAIN_SHEET_ID
      );

      console.log(
        "✅ DM scheduler started"
      );

    } catch (err) {

      console.error(
        "❌ DM scheduler error:"
      );

      console.error(err);

    }

  } else {

    console.log(
      "⚠️ DM scheduler disabled"
    );

  }

});

// ================= INTERACTIONS =================

client.on(
  "interactionCreate",
  async interaction => {

    if (!interaction.isChatInputCommand())
      return;

    console.log(
      `🔥 Interaction received: ${interaction.commandName}`
    );

    try {

      // ================= VERIFY =================

      if (
        interaction.commandName ===
          "verify" &&
        handleVerify
      ) {

        return await handleVerify(
          interaction
        );

      }

      // ================= EVENT BANS =================

  try {

    console.log(
      "EVENT BAN RAW:",
      eventBanCommand
    );

    if (!eventBanCommand) {

      console.log(
        "❌ eventBanCommand missing"
      );

    } else {

      const json =
        eventBanCommand.toJSON();

      console.log(
        "EVENT BAN JSON:",
        json
      );

      commandJSON.push(json);

      console.log(
        `📦 Registering command: ${json.name}`
      );

    }

  } catch (err) {

    console.error(
      "❌ EVENT BAN REGISTRATION ERROR:"
    );

    console.error(err);

  }

      // ================= STANDARD COMMANDS =================

      const command =
        client.commands.get(
          interaction.commandName
        );

      if (!command) {

        console.log(
          `❌ Command not found: ${interaction.commandName}`
        );

        if (
          !interaction.replied &&
          !interaction.deferred
        ) {

          await interaction.reply({
            content:
              "❌ Command not loaded.",
            ephemeral: true
          });

        }

        return;

      }

      console.log(
        `⚡ Executing: ${interaction.commandName}`
      );

      await command.execute(interaction, {
        SUBMIT_SHEET_ID,
        MAIN_SHEET_ID
      });

    } catch (err) {

      console.error(
        "❌ Interaction error:"
      );

      console.error(err);

      try {

        if (
          interaction.replied ||
          interaction.deferred
        ) {

          await interaction.followUp({
            content:
              "❌ An error occurred while executing this command.",
            ephemeral: true
          });

        } else {

          await interaction.reply({
            content:
              "❌ An error occurred while executing this command.",
            ephemeral: true
          });

        }

      } catch (replyErr) {

        console.error(
          "❌ Failed sending error reply:"
        );

        console.error(replyErr);

      }

    }

  }
);

// ================= HEALTH SERVER =================

const PORT =
  process.env.PORT || 8080;

http
  .createServer((req, res) => {

    res.writeHead(200);

    res.end("OK");

  })
  .listen(PORT, () => {

    console.log(
      `🌐 Health server running on ${PORT}`
    );

  });

// ================= LOGIN =================

client
  .login(DISCORD_TOKEN)

  .then(() => {

    console.log(
      "✅ Bot login successful"
    );

  })

  .catch(err => {

    console.error("❌ Login error:");

    console.error(err);

  });