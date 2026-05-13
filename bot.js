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
  } = require("./welcome-ping"));

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

  // ================= REGISTER NORMAL COMMANDS =================

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
      "✅ Standard slash commands registered"
    );

  } catch (err) {

    console.error(
      "❌ Standard command registration failed:"
    );

    console.error(err);

  }

  // ================= REGISTER EVENTBAN SEPARATELY =================

  if (eventBanCommand) {

    try {

      const eventJSON =
        eventBanCommand.toJSON();

      console.log(
        "EVENTBAN JSON:",
        eventJSON
      );

      await rest.post(
        Routes.applicationGuildCommands(
          client.user.id,
          "1371615693392576580"
        ),
        {
          body: eventJSON
        }
      );

      console.log(
        "✅ Eventban registered separately"
      );

    } catch (err) {

      console.error(
        "❌ Eventban registration failed:"
      );

      console.error(err);

    }

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

    // ================= BUTTONS =================

    if (interaction.isButton()) {

      try {

        const {
          activeCalls
        } = require("./commands/gamecall");

        const call =
          activeCalls.get(
            interaction.channel.id
          );

        // ================= OVERRIDE =================

        if (
          interaction.customId.startsWith(
            "gamecall_override_"
          )
        ) {

          return await interaction.reply({
            content:
              "Override system not built yet.",
            ephemeral: true
          });

        }

        // ================= STOP FOLLOW UPS =================

        if (
          interaction.customId.startsWith(
            "staff_stop_followups_"
          )
        ) {

          if (!call) {

            return await interaction.reply({
              content:
                "❌ No active game call found.",
              ephemeral: true
            });

          }

          clearTimeout(call.t1);
          clearTimeout(call.t2);

          activeCalls.delete(
            interaction.channel.id
          );

          return await interaction.reply({
            content:
              "✅ Follow up messages stopped.",
            ephemeral: true
          });

        }

        // ================= CANCEL GAME =================

        if (
          interaction.customId.startsWith(
            "staff_cancel_game_"
          )
        ) {

          if (!call) {

            return await interaction.reply({
              content:
                "❌ No active game call found.",
              ephemeral: true
            });

          }

          clearTimeout(call.t1);
          clearTimeout(call.t2);

          activeCalls.delete(
            interaction.channel.id
          );

          await interaction.channel.send(
            "❌ GAME CALL CANCELLED"
          );

          return await interaction.reply({
            content:
              "✅ Game call cancelled.",
            ephemeral: true
          });

        }

      } catch (err) {

        console.error(
          "❌ Button interaction error:"
        );

        console.error(err);

        try {

          if (
            !interaction.replied &&
            !interaction.deferred
          ) {

            await interaction.reply({
              content:
                "❌ Button interaction failed.",
              ephemeral: true
            });

          }

        } catch {}

      }

      return;

    }

    // ================= CHAT COMMANDS =================

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

      if (
        interaction.commandName ===
          "eventban" &&
        handleEventBan
      ) {

        return await handleEventBan(
          interaction
        );

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