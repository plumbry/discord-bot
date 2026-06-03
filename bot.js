require("dotenv").config();

console.log("=== BOT STARTING ===");

const GUILD_ID =
  process.env.GUILD_ID || "1371615693392576580";

// ================= CORE =================

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const http = require("http");
const {
  hasMemberSyncApiKey,
  syncMemberToWebsite,
  syncAllGuildMembers
} = require("./lib/memberSyncApi");

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

// ================= GIRL ROLE (sheet + rejoin restore) =================

let loadGirlCache = null;
let reapplyGirlRoleOnJoin = null;
let handleGirlRoleGained = null;
let backfillGirlRolesFromDiscord = null;
let shouldBackfillGirlRoleOnStartup = null;
let isGirlRoleSheetConfigured = null;

try {
  ({
    loadGirlCache,
    reapplyGirlRoleOnJoin,
    handleGirlRoleGained,
    backfillGirlRolesFromDiscord,
    shouldBackfillOnStartup: shouldBackfillGirlRoleOnStartup,
    isConfigured: isGirlRoleSheetConfigured
  } = require("./lib/girlRoleSheet"));

  console.log("✅ girl role sheet module loaded");
} catch (err) {
  console.error("⚠️ girlRoleSheet not loaded:", err?.message || err);
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
let syncRolesFromSheet = null;
let processRoleSyncPayload = null;

try {

  ({
    startBanExpiryChecker,
    syncRolesFromSheet,
    processRoleSyncPayload
  } = require("./banExpiryChecker"));

  console.log("✅ event ban role sync loaded");

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

// ================= SCRIM REMIND SHEET =================

let startScrimRemindScheduler = null;

try {

  ({
    startScrimRemindScheduler
  } = require("./lib/scrimEventSheet"));

  console.log("✅ scrimEventSheet loaded");

} catch (err) {

  console.error(
    "⚠️ scrimEventSheet not loaded:"
  );

  console.error(err);

}

// ================= GAME CALL =================

const {
  activeCalls
} = require("./commands/gamecall");

// ================= GUARDIAN TIER WIPE =================

let handleGuardianRemoval = null;

try {

  ({
    handleGuardianRemoval
  } = require("./lib/guardianWatch"));

  console.log("✅ guardian tier wipe loaded");

} catch (err) {

  console.error(
    "⚠️ guardianWatch not loaded:"
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
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildScheduledEvents
  ]
});

client.commands = new Map();

const MEMBER_SYNC_UPDATE_DEBOUNCE_MS = Number(
  process.env.MEMBER_SYNC_UPDATE_DEBOUNCE_MS || 2000
);
const MEMBER_SYNC_BACKFILL_INTERVAL_MS = Number(
  process.env.MEMBER_SYNC_BACKFILL_INTERVAL_MS || 4 * 60 * 60 * 1000
);
const MEMBER_SYNC_ON_JOIN = String(
  process.env.MEMBER_SYNC_ON_JOIN || "false"
).toLowerCase() !== "false";
const MEMBER_SYNC_ON_UPDATE = String(
  process.env.MEMBER_SYNC_ON_UPDATE || "false"
).toLowerCase() === "true";

const memberSyncDebounceTimers = new Map();
const memberSyncSignatures = new Map();
let backfillRunning = false;

function buildMemberSignature(member) {
  const roles = member.roles.cache
    .filter(role => role.name !== "@everyone")
    .map(role => `${role.id}:${role.name}`)
    .sort();

  return JSON.stringify({
    id: member.id,
    username: member.user?.username || "",
    nickname: member.nickname || null,
    joined_at: member.joinedAt ? member.joinedAt.toISOString() : null,
    roles
  });
}

async function syncMemberWithGuards(member, source) {
  if (!member || member.user?.bot) {
    return;
  }

  if (!hasMemberSyncApiKey()) {
    return;
  }

  const signature = buildMemberSignature(member);
  const previous = memberSyncSignatures.get(member.id);
  if (previous === signature) {
    return;
  }

  const result = await syncMemberToWebsite(member);

  if (result.ok) {
    memberSyncSignatures.set(member.id, signature);
    console.log(`[MEMBER SYNC] synced ${member.user.tag} (${source})`);
    return;
  }

  if (!result.skipped) {
    console.error(
      `[MEMBER SYNC] failed ${member.user?.tag || member.id} (${source}):`,
      result.status || "no_status",
      result.body || result.error
    );
  }
}

function scheduleMemberSync(member, source) {
  if (!member || member.user?.bot || !hasMemberSyncApiKey()) {
    return;
  }

  const key = member.id;
  const existing = memberSyncDebounceTimers.get(key);

  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    memberSyncDebounceTimers.delete(key);
    syncMemberWithGuards(member, source).catch(err => {
      console.error("[MEMBER SYNC] schedule failure:", err?.message || err);
    });
  }, MEMBER_SYNC_UPDATE_DEBOUNCE_MS);

  memberSyncDebounceTimers.set(key, timer);
}

async function runFullMemberBackfill(client, reason) {
  if (!hasMemberSyncApiKey()) {
    return;
  }

  if (backfillRunning) {
    console.log(`[MEMBER SYNC] skipping backfill (${reason}) - already running`);
    return;
  }

  backfillRunning = true;

  try {
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);

    if (!guild) {
      console.error("[MEMBER SYNC] backfill guild not found:", GUILD_ID);
      return;
    }

    const stats = await syncAllGuildMembers(guild);
    console.log(
      `[MEMBER SYNC] backfill (${reason}) complete: ` +
        `${stats.successCount} success, ${stats.skippedCount} skipped, ${stats.errorCount} errors`
    );
  } catch (err) {
    console.error("[MEMBER SYNC] backfill failed:", err?.message || err);
  } finally {
    backfillRunning = false;
  }
}

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

client.once("ready", async () => {

  console.log(
    `🚀 Logged in as ${client.user.tag}`
  );

  // ================= GIRL ROLE SHEET =================

  if (loadGirlCache && isGirlRoleSheetConfigured?.()) {
    try {
      await loadGirlCache();

      if (
        shouldBackfillGirlRoleOnStartup?.() &&
        backfillGirlRolesFromDiscord
      ) {
        const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);

        if (guild) {
          await backfillGirlRolesFromDiscord(guild);
        }
      }

      console.log("✅ Girl Role sheet sync ready");
    } catch (err) {
      console.error("[GIRL ROLE] startup failed:", err?.message || err);
    }
  }

  // ================= BAN CHECKER =================

  if (startBanExpiryChecker) {

    try {

      startBanExpiryChecker(client);

      console.log(
        "✅ Event ban / probation role sync started (push-driven)"
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

  // ================= EVENTBAN =================

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
        "❌ Failed converting eventban command:"
      );

      console.error(err);

    }

  }

  // Register slash commands in the background so interactions are not blocked.
  void (async () => {
    try {

      await rest.put(Routes.applicationCommands(client.user.id), {
        body: []
      });

      console.log("✅ Cleared global slash commands");

      await rest.put(
        Routes.applicationGuildCommands(
          client.user.id,
          GUILD_ID
        ),
        {
          body: commandJSON
        }
      );

      console.log(
        `Registered ${commandJSON.length} slash commands to ${GUILD_ID}`
      );

      const submitCmd = commandJSON.find((c) => c.name === "submit");
      if (submitCmd) {
        const submitOpts = (submitCmd.options || [])
          .map((o) => o.name)
          .join(", ") || "(none)";
        console.log(
          `📋 /submit options: ${submitOpts} — ${submitCmd.description}`
        );
      }

    } catch (err) {

      console.error(
        "❌ Command registration failed:"
      );

      console.error(err);

    }
  })();

  // ================= MEMBER SYNC BACKFILL =================
  if (hasMemberSyncApiKey()) {
    console.log(
      `[MEMBER SYNC] config: on_join=${MEMBER_SYNC_ON_JOIN}, on_update=${MEMBER_SYNC_ON_UPDATE}, debounce_ms=${MEMBER_SYNC_UPDATE_DEBOUNCE_MS}, backfill_interval_ms=${MEMBER_SYNC_BACKFILL_INTERVAL_MS}`
    );

    if (MEMBER_SYNC_BACKFILL_INTERVAL_MS > 0) {
      setInterval(() => {
        runFullMemberBackfill(client, "scheduled").catch(console.error);
      }, MEMBER_SYNC_BACKFILL_INTERVAL_MS);

      console.log(
        `[MEMBER SYNC] scheduled full backfill every ${Math.round(
          MEMBER_SYNC_BACKFILL_INTERVAL_MS / 1000
        )}s`
      );
    } else {
      console.log("[MEMBER SYNC] scheduled full backfill disabled");
    }
  } else {
    console.warn("[MEMBER SYNC] DISCORD_SYNC_API_KEY missing - auto sync disabled");
  }

  // ================= DM SCHEDULER (staggered start) =================

  if (
    dm?.startDMScheduler &&
    MAIN_SHEET_ID
  ) {

    setTimeout(() => {

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

    }, 90 * 1000);

  } else {

    console.log(
      "⚠️ DM scheduler disabled"
    );

  }

  // ================= SCRIM REMIND SCHEDULER (staggered start) =================

  if (
    startScrimRemindScheduler &&
    MAIN_SHEET_ID
  ) {

    setTimeout(() => {

      try {

        startScrimRemindScheduler(client);

      } catch (err) {

        console.error(
          "❌ Scrim remind scheduler error:"
        );

        console.error(err);

      }

    }, 100 * 1000);

  } else {

    console.log(
      "⚠️ Scrim remind scheduler disabled"
    );

  }

  // ================= SCHEDULED EVENTS HEALTH CHECK =================

  try {
    const {
      fetchGuildScheduledEvents,
      scheduleEventCacheRefresh
    } = require("./lib/guildScheduledEvents");
    const guild = await client.guilds.fetch(GUILD_ID);
    const events = await fetchGuildScheduledEvents(guild, { force: true });

    console.log(
      `[STARTUP] ${guild.name} (${GUILD_ID}): ${events.length} scheduled event(s)`
    );

    for (const event of events.slice(0, 8)) {
      console.log(
        `[STARTUP]   - ${event.name} | id=${event.id} | status=${event.status}`
      );
    }

    setInterval(() => {
      const cachedGuild = client.guilds.cache.get(GUILD_ID);

      if (cachedGuild) {
        scheduleEventCacheRefresh(cachedGuild);
      }
    }, 4 * 60 * 60 * 1000);
  } catch (err) {
    console.error("[STARTUP] Scheduled events check failed:", err?.message || err);
  }

});

// ================= INTERACTIONS =================

client.on(
  "interactionCreate",
  async interaction => {

    // Acknowledge long-running /roletagged before other handler work.
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "roletagged" &&
      !interaction.deferred &&
      !interaction.replied
    ) {
      await interaction.deferReply();
    }

    // ================= BUTTONS =================

    if (interaction.isButton()) {

      try {

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

          const modal =
            new ModalBuilder()
              .setCustomId(
                "override_game_code"
              )
              .setTitle(
                "Override Game Code"
              );

          const codeInput =
            new TextInputBuilder()
              .setCustomId("new_code")
              .setLabel("New Game Code")
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true)
              .setMaxLength(32);

          const row =
            new ActionRowBuilder()
              .addComponents(
                codeInput
              );

          modal.addComponents(row);

          return await interaction.showModal(
            modal
          );

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
                "❌ No active game call found",
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
              "✅ Follow up messages stopped",
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
                "❌ No active game call found",
              ephemeral: true
            });

          }

          clearTimeout(call.t1);
          clearTimeout(call.t2);

          activeCalls.delete(
            interaction.channel.id
          );

          await interaction.channel.send(
            "❌ GAME CANCELLED"
          );

          return await interaction.reply({
            content:
              "✅ Game call cancelled",
            ephemeral: true
          });

        }

        for (const command of client.commands.values()) {
          if (typeof command.handleButton !== "function") {
            continue;
          }

          const handled = await command.handleButton(
            interaction
          );

          if (handled) {
            return;
          }
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

    // ================= SELECT MENUS =================

    if (interaction.isStringSelectMenu()) {

      try {

        for (const command of client.commands.values()) {
          if (typeof command.handleSelectMenu !== "function") {
            continue;
          }

          const handled = await command.handleSelectMenu(
            interaction
          );

          if (handled) {
            return;
          }
        }

      } catch (err) {

        console.error(
          "❌ Select menu interaction error:"
        );

        console.error(err);

        try {

          if (
            !interaction.replied &&
            !interaction.deferred
          ) {

            await interaction.reply({
              content:
                "❌ Select menu interaction failed.",
              ephemeral: true
            });

          }

        } catch {}

      }

      return;

    }

    // ================= MODALS =================

    if (interaction.isModalSubmit()) {

      try {

        if (
          interaction.customId ===
          "override_game_code"
        ) {

          const {
            activeCalls
          } = require("./commands/gamecall");

          const call =
            activeCalls.get(
              interaction.channel.id
            );

          if (!call) {

            return await interaction.reply({
              content:
                "❌ No active game call found.",
              ephemeral: true
            });

          }

          const newCode =
            interaction.fields.getTextInputValue(
              "new_code"
            );

          call.code = newCode;

          const msg =
            await interaction.channel.messages.fetch(
              call.messageId
            );

          await msg.edit(
`GAME ${call.gameNumber} ${call.region} CODE ${newCode}
GAME ${call.gameNumber} STARTING SOON
WHO IS NOT IN <@&${call.roleId}>`
          );

          return await interaction.reply({
            content:
              `✅ Game code overridden to: ${newCode}`,
            ephemeral: true
          });

        }

        for (const command of client.commands.values()) {
          if (typeof command.handleModalSubmit !== "function") {
            continue;
          }

          const handled = await command.handleModalSubmit(
            interaction
          );

          if (handled) {
            return;
          }
        }

      } catch (err) {

        console.error(
          "❌ Modal interaction error:"
        );

        console.error(err);

        try {

          if (
            !interaction.replied &&
            !interaction.deferred
          ) {

            await interaction.reply({
              content:
                "❌ Modal action failed.",
              ephemeral: true
            });

          }

        } catch {}

      }

      return;

    }

    // ================= AUTOCOMPLETE =================

    if (interaction.isAutocomplete()) {

      const command =
        client.commands.get(
          interaction.commandName
        );

      if (command?.autocomplete) {

        try {

          return await command.autocomplete(
            interaction
          );

        } catch (err) {

          console.error(
            "❌ Autocomplete error:",
            err
          );

          return interaction.respond([]).catch(() => {});

        }

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

// ================= MESSAGE DELETE (rules/bans tracking) =================

const { handleBansMessageDeleted } = require("./lib/eventBansShared");

client.on("messageDelete", async message => {
  try {
    await handleBansMessageDeleted(message);
  } catch (err) {
    console.error("[BANS MESSAGE DELETE]", err?.message || err);
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

    if (MEMBER_SYNC_ON_JOIN) {
      scheduleMemberSync(member, "guildMemberAdd");
    }

    if (reapplyGirlRoleOnJoin) {
      await reapplyGirlRoleOnJoin(member);
    }

  } catch (err) {

    console.error(
      "❌ guildMemberAdd error:"
    );

    console.error(err);

  }

});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    if (!newMember || newMember.user?.bot) {
      return;
    }

    const nicknameChanged =
      (oldMember?.nickname || null) !== (newMember?.nickname || null);
    const oldRoleIds = new Set(oldMember?.roles?.cache?.keys?.() || []);
    const newRoleIds = new Set(newMember?.roles?.cache?.keys?.() || []);
    const roleCountChanged = oldRoleIds.size !== newRoleIds.size;
    const rolesChanged =
      roleCountChanged ||
      [...newRoleIds].some(roleId => !oldRoleIds.has(roleId));

    if (!nicknameChanged && !rolesChanged) {
      return;
    }

    if (MEMBER_SYNC_ON_UPDATE) {
      scheduleMemberSync(newMember, "guildMemberUpdate");
    }

    if (handleGirlRoleGained) {
      await handleGirlRoleGained(oldMember, newMember);
    }
  } catch (err) {
    console.error("[MEMBER SYNC] guildMemberUpdate error:", err?.message || err);
  }
});

// ================= GUARDIAN TIER WIPE (kick/ban -> delete tier roles) =================

client.on("guildMemberRemove", async member => {
  if (!handleGuardianRemoval) {
    return;
  }

  try {
    await handleGuardianRemoval(client, member);
  } catch (err) {
    console.error("[GUARDIAN WIPE] guildMemberRemove error:", err?.message || err);
  }
});

// ================= HTTP (health + event-ban webhook) =================

const PORT =
  process.env.PORT || 8080;

const {
  createWebhookRequestHandler,
  WEBHOOK_PATH,
  ROLE_SYNC_WEBHOOK_PATH
} = require("./lib/eventBanWebhook");

const {
  createTierClearHandler,
  TIER_CLEAR_PATH
} = require("./lib/tierClearApi");

const webhookHandler = createWebhookRequestHandler(
  client,
  processRoleSyncPayload ||
    syncRolesFromSheet ||
    (() => Promise.resolve())
);

const tierClearHandler = createTierClearHandler(client, {
  guildId: GUILD_ID
});

http
  .createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(client.isReady() ? "ok" : "starting");
      return;
    }

    (async () => {
      if (await tierClearHandler(req, res)) {
        return;
      }

      await webhookHandler(req, res);
    })().catch(err => {
      console.error("[HTTP]", err);

      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      }
    });
  })
  .listen(PORT, () => {
    console.log(`🌐 HTTP server on ${PORT}`);

    if (process.env.EVENT_BAN_WEBHOOK_SECRET) {
      console.log(
        `🔗 Role sync webhooks: POST ${WEBHOOK_PATH} or ${ROLE_SYNC_WEBHOOK_PATH} ` +
          "(Authorization: Bearer <secret>)"
      );
    } else {
      console.warn(
        "⚠️ EVENT_BAN_WEBHOOK_SECRET not set — push webhooks disabled (startup poll + /eventban sync only)"
      );
    }

    if (process.env.TIER_CLEAR_API_SECRET || process.env.EVENT_BAN_WEBHOOK_SECRET) {
      console.log(
        `🔗 Tier clear endpoint: POST ${TIER_CLEAR_PATH} (Authorization: Bearer <secret>)`
      );
    } else {
      console.warn(
        "⚠️ TIER_CLEAR_API_SECRET not set — tier clear endpoint disabled"
      );
    }
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
