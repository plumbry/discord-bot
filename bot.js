require("dotenv").config();

console.log("=== BOT STARTING ===");

const GUILD_ID =
  process.env.GUILD_ID || "1371615693392576580";

// ================= CORE =================

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");
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
const BOT_STATUS_CHANNEL_ID =
  process.env.BOT_STATUS_CHANNEL_ID || "1471082166535454780";

console.log("ENV CHECK:", {
  DISCORD_TOKEN: !!DISCORD_TOKEN,
  GOOGLE: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
  MAIN: !!MAIN_SHEET_ID,
  SUBMIT: !!SUBMIT_SHEET_ID
});

// ================= SAFE IMPORTS =================

let verifyCommand = null;
let handleVerify = null;
let boomerCommand = null;
let handleBoomer = null;
let handleWelcome = null;
let handleWelcomeReaction = null;

try {

  ({
    verifyCommand,
    handleVerify,
    boomerCommand,
    handleBoomer,
    handleWelcome,
    handleWelcomeReaction
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
let startGirlRoleReconciler = null;

try {
  ({
    loadGirlCache,
    reapplyGirlRoleOnJoin,
    handleGirlRoleGained,
    backfillGirlRolesFromDiscord,
    shouldBackfillOnStartup: shouldBackfillGirlRoleOnStartup,
    isConfigured: isGirlRoleSheetConfigured,
    startGirlRoleReconciler
  } = require("./lib/girlRoleSheet"));

  console.log("✅ girl role sheet module loaded");
} catch (err) {
  console.error("⚠️ girlRoleSheet not loaded:", err?.message || err);
}

// ================= GENDER SHEET (female-evaluated pending role) =================

let loadGenderEvalCache = null;
let isGenderEvalSheetConfigured = null;
let startGenderEvalReconciler = null;

try {
  ({
    loadGenderEvalCache,
    isConfigured: isGenderEvalSheetConfigured,
    startGenderEvalReconciler
  } = require("./lib/genderEvalSheet"));

  console.log("✅ gender eval sheet module loaded");
} catch (err) {
  console.error("⚠️ genderEvalSheet not loaded:", err?.message || err);
}

// ================= FEMALE PENDING ROLE (join + verify cleanup) =================

let tryApplyFemalePendingRole = null;
let handleFemalePendingOnMemberUpdate = null;
let reconcileFemalePendingRolesFromSheet = null;

try {
  ({
    tryApplyFemalePendingRole,
    handleFemalePendingOnMemberUpdate,
    reconcileFemalePendingRolesFromSheet
  } = require("./lib/femalePendingRole"));

  console.log("✅ female pending role module loaded");
} catch (err) {
  console.error("⚠️ femalePendingRole not loaded:", err?.message || err);
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

// ================= LFG =================

let startLfgExpiryScheduler = null;
let handleLfgPostRoleGained = null;

try {

  ({
    startLfgExpiryScheduler
  } = require("./lib/lfgExpiry"));

  ({
    handleLfgPostRoleGained
  } = require("./lib/lfgPostMatching"));

  console.log("✅ LFG module loaded");

} catch (err) {

  console.error(
    "⚠️ LFG module not loaded:"
  );

  console.error(err);

}

// ================= GAME CALL =================

const {
  activeCalls
} = require("./commands/gamecall");

let restoreScrimDashboard = null;

try {
  ({
    restoreScrimDashboard
  } = require("./commands/scrimdashboard"));

  console.log("✅ scrim dashboard module loaded");
} catch (err) {
  console.error("⚠️ scrim dashboard not loaded:", err?.message || err);
}

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
    GatewayIntentBits.GuildPresences, // privileged: enable Presence Intent in the Discord Developer Portal
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember
  ]
});

client.commands = new Map();

let botReadyForStatus = false;
let shuttingDown = false;

async function postBotStatus(message) {
  if (!client.isReady()) {
    return;
  }

  const channel = await client.channels
    .fetch(BOT_STATUS_CHANNEL_ID)
    .catch(() => null);

  if (!channel?.isTextBased?.()) {
    console.warn("[BOT STATUS] channel unavailable:", BOT_STATUS_CHANNEL_ID);
    return;
  }

  await channel.send(message);
}

async function gracefulShutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[SHUTDOWN] ${signal} received`);

  if (botReadyForStatus) {
    try {
      await Promise.race([
        postBotStatus("🔴 Bot is offline - please do not use commands"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("status post timeout")), 5000)
        )
      ]);
    } catch (err) {
      console.error("[BOT STATUS] offline post failed:", err?.message || err);
    }
  }

  try {
    client.destroy();
  } catch (_) {}

  process.exit(0);
}

process.once("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
process.once("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

// Automatic member sync is retired on the website (POST /api/discord/sync-member → 410).
// Sync from Admin → Member Management → Discord sync tools. Manual /syncmembers still available.
const MEMBER_SYNC_AUTO_ENABLED =
  String(process.env.MEMBER_SYNC_AUTO_ENABLED || "false").toLowerCase() ===
  "true";
const MEMBER_SYNC_UPDATE_DEBOUNCE_MS = Number(
  process.env.MEMBER_SYNC_UPDATE_DEBOUNCE_MS || 2000
);
const MEMBER_SYNC_BACKFILL_INTERVAL_MS = Number(
  process.env.MEMBER_SYNC_BACKFILL_INTERVAL_MS || 0
);
const MEMBER_SYNC_ON_JOIN =
  MEMBER_SYNC_AUTO_ENABLED &&
  String(process.env.MEMBER_SYNC_ON_JOIN || "false").toLowerCase() === "true";
const MEMBER_SYNC_ON_UPDATE =
  MEMBER_SYNC_AUTO_ENABLED &&
  String(process.env.MEMBER_SYNC_ON_UPDATE || "false").toLowerCase() === "true";

const memberSyncDebounceTimers = new Map();
const memberSyncSignatures = new Map();
const femalePendingRoleTimers = new Map();
let backfillRunning = false;

const MEMBER_SYNC_JOIN_DEBOUNCE_MS = Number(
  process.env.MEMBER_SYNC_JOIN_DEBOUNCE_MS || 1000
);
const FEMALE_PENDING_ROLE_JOIN_DELAY_MS = Number(
  process.env.FEMALE_PENDING_ROLE_JOIN_DELAY_MS ||
    MEMBER_SYNC_JOIN_DEBOUNCE_MS + 100
);

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

    if (source === "guildMemberAdd" && tryApplyFemalePendingRole) {
      await tryApplyFemalePendingRole(member, { source: "guildMemberAdd" });
    }

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
  if (
    !MEMBER_SYNC_AUTO_ENABLED ||
    !member ||
    member.user?.bot ||
    !hasMemberSyncApiKey()
  ) {
    return;
  }

  const debounceMs =
    source === "guildMemberAdd"
      ? MEMBER_SYNC_JOIN_DEBOUNCE_MS
      : MEMBER_SYNC_UPDATE_DEBOUNCE_MS;

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
  }, debounceMs);

  memberSyncDebounceTimers.set(key, timer);
}

function scheduleFemalePendingRoleOnJoin(member) {
  if (!tryApplyFemalePendingRole || !member || member.user?.bot) {
    return;
  }

  const key = member.id;
  const existing = femalePendingRoleTimers.get(key);

  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    femalePendingRoleTimers.delete(key);
    tryApplyFemalePendingRole(member, { source: "guildMemberAdd" }).catch(
      err => {
        console.error(
          "[FEMALE PENDING ROLE] join schedule failure:",
          err?.message || err
        );
      }
    );
  }, FEMALE_PENDING_ROLE_JOIN_DELAY_MS);

  femalePendingRoleTimers.set(key, timer);
}

async function runFullMemberBackfill(client, reason) {
  if (!MEMBER_SYNC_AUTO_ENABLED || !hasMemberSyncApiKey()) {
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
      command.decommissioned
        ? `✅ Loaded command: ${command.data.name} (decommissioned — not registered)`
        : `✅ Loaded command: ${command.data.name}`
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

  botReadyForStatus = true;

  try {
    await postBotStatus("🟢 Bot is online");
    console.log("[BOT STATUS] posted online");
  } catch (err) {
    console.error("[BOT STATUS] online post failed:", err?.message || err);
  }

  if (restoreScrimDashboard) {
    try {
      await restoreScrimDashboard(client);
    } catch (err) {
      console.error("[SCRIM DASHBOARD] startup restore failed:", err?.message || err);
    }
  }

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
          void backfillGirlRolesFromDiscord(guild).catch(err => {
            console.error("[GIRL ROLE] startup backfill failed:", err?.message || err);
          });
        }
      }

      console.log("✅ Girl Role sheet sync ready");

      if (startGirlRoleReconciler) {
        startGirlRoleReconciler(client, GUILD_ID);
      }
    } catch (err) {
      console.error("[GIRL ROLE] startup failed:", err?.message || err);
    }
  }

  // ================= GENDER SHEET (pending female role) =================

  if (loadGenderEvalCache && isGenderEvalSheetConfigured?.()) {
    try {
      await loadGenderEvalCache();

      if (startGenderEvalReconciler && reconcileFemalePendingRolesFromSheet) {
        startGenderEvalReconciler(
          client,
          GUILD_ID,
          reconcileFemalePendingRolesFromSheet
        );
      }

      console.log("✅ Gender Sheet sync ready");
    } catch (err) {
      console.error("[GENDER SHEET] startup failed:", err?.message || err);
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

    if (command.decommissioned) {
      console.log(
        `⏸️ Skipped registering decommissioned command: ${command.data.name}`
      );
      continue;
    }

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

  // ================= BOOMER =================

  if (boomerCommand) {

    try {

      const json =
        boomerCommand.toJSON();

      commandJSON.push(json);

      console.log(
        `📦 Registering command: ${json.name}`
      );

    } catch (err) {

      console.error(
        "❌ Failed converting boomer command:"
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
  if (!MEMBER_SYNC_AUTO_ENABLED) {
    console.log(
      "[MEMBER SYNC] automatic sync disabled (use website admin Discord sync tools)"
    );
  } else if (hasMemberSyncApiKey()) {
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

  // ================= LFG EXPIRY SCHEDULER =================

  if (startLfgExpiryScheduler) {

    try {

      startLfgExpiryScheduler(client);

    } catch (err) {

      console.error(
        "❌ LFG expiry scheduler error:"
      );

      console.error(err);

    }

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

client.on("guildScheduledEventUpdate", async (_oldEvent, event) => {
  try {
    const { getLfgEvent } = require("./lib/lfgSheet");
    const { eventHasStarted, expireLfgEvent } = require("./lib/lfgExpiry");
    const config = await getLfgEvent(event.id);

    if (!config?.lfgEnabled) {
      return;
    }

    if (
      eventHasStarted(config, {
        scheduledStartAt: event.scheduledStartAt,
        status: event.status
      })
    ) {
      await expireLfgEvent(client, config, "event_started");
    }
  } catch (err) {
    console.error("[LFG] scheduled event update failed:", err?.message || err);
  }
});

client.on("guildScheduledEventDelete", async event => {
  try {
    const { getLfgEvent } = require("./lib/lfgSheet");
    const { expireLfgEvent } = require("./lib/lfgExpiry");
    const config = await getLfgEvent(event.id);

    if (!config) {
      return;
    }

    await expireLfgEvent(client, config, "event_started");
  } catch (err) {
    console.error("[LFG] scheduled event delete failed:", err?.message || err);
  }
});

// ================= INTERACTIONS =================

client.on(
  "interactionCreate",
  async interaction => {

    // Acknowledge long-running signup commands before other handler work.
    if (
      interaction.isChatInputCommand() &&
      (interaction.commandName === "roletagged" ||
        interaction.commandName === "rolecaptain" ||
        interaction.commandName === "roleuntagged" ||
        interaction.commandName === "checkrules" ||
        interaction.commandName === "disqualify" ||
        interaction.commandName === "unreg" ||
        interaction.commandName === "voicecheck" ||
        interaction.commandName === "online") &&
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

    if (
      interaction.isStringSelectMenu() ||
      interaction.isChannelSelectMenu?.() ||
      interaction.isRoleSelectMenu?.() ||
      interaction.isUserSelectMenu?.()
    ) {

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
            activeCalls,
            formatGameCallMessage
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
            formatGameCallMessage({
              game: call.gameNumber,
              region: call.region,
              code: newCode,
              startLine: `GAME ${call.gameNumber} STARTING SOON`,
              roleMention: `<@&${call.roleId}>`
            })
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

      // ================= BOOMER =================

      if (
        interaction.commandName ===
          "boomer" &&
        handleBoomer
      ) {

        return await handleBoomer(
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
const {
  handleReactionAdd,
  handleReactionRemove,
  handleMessageDelete: handleReactionRoleMessageDelete
} = require("./lib/reactionRoles");

client.on("messageDelete", async message => {
  try {
    await handleBansMessageDeleted(message);
  } catch (err) {
    console.error("[BANS MESSAGE DELETE]", err?.message || err);
  }

  try {
    await handleReactionRoleMessageDelete(message);
  } catch (err) {
    console.error("[REACTION ROLES MESSAGE DELETE]", err?.message || err);
  }
});

client.on("messageReactionAdd", async (reaction, user) => {
  if (handleWelcomeReaction) {
    try {
      await handleWelcomeReaction(reaction, user);
    } catch (err) {
      console.error("[WELCOME REACTION]", err?.message || err);
    }
  }

  try {
    await handleReactionAdd(reaction, user);
  } catch (err) {
    console.error("[REACTION ROLES ADD]", err?.message || err);
  }
});

client.on("messageReactionRemove", async (reaction, user) => {
  try {
    await handleReactionRemove(reaction, user);
  } catch (err) {
    console.error("[REACTION ROLES REMOVE]", err?.message || err);
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

    // After sheet reapply so rejoining sheet-verified members are not given NFV
    let femalePendingApplied = false;

    if (tryApplyFemalePendingRole) {
      const result = await tryApplyFemalePendingRole(member, {
        source: "guildMemberAdd"
      }).catch(err => {
        console.error(
          "[FEMALE PENDING ROLE] join immediate failure:",
          err?.message || err
        );
        return null;
      });

      femalePendingApplied = Boolean(result?.applied);
    }

    if (!femalePendingApplied) {
      scheduleFemalePendingRoleOnJoin(member);
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

    if (handleFemalePendingOnMemberUpdate) {
      await handleFemalePendingOnMemberUpdate(oldMember, newMember);
    }

    if (handleLfgPostRoleGained) {
      await handleLfgPostRoleGained(oldMember, newMember);
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

// ================= HTTP (webhooks; health served from lib/flyHealth.js) =================

const {
  setHealthClient,
  setMainHandler
} = require("./lib/flyHealth");

setHealthClient(client);

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

setMainHandler(async (req, res) => {
  if (await tierClearHandler(req, res)) {
    return;
  }

  await webhookHandler(req, res);
});

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
