const { GuildScheduledEventStatus } = require("discord.js");

const {
  fetchGuildScheduledEvents
} = require("./guildScheduledEvents");

const {
  listLfgEvents,
  upsertLfgEvent,
  closeActiveRequestsForEvent
} = require("./lfgSheet");

const CHECK_INTERVAL_MS = 60 * 1000;

let expiryTimer = null;

function eventHasStarted(config, discordEvent, now = Date.now()) {
  const status = Number(discordEvent?.status);

  if (
    status === GuildScheduledEventStatus.Active ||
    status === GuildScheduledEventStatus.Completed ||
    status === GuildScheduledEventStatus.Cancelled
  ) {
    return true;
  }

  const start = discordEvent?.scheduledStartAt
    ? discordEvent.scheduledStartAt.getTime()
    : config.startTime
      ? Date.parse(config.startTime)
      : NaN;

  return Number.isFinite(start) && start <= now;
}

async function expireLfgEvent(client, config, reason = "event_started") {
  if (config.lfgEnabled) {
    await upsertLfgEvent({
      discordEventId: config.discordEventId,
      guildId: config.guildId,
      lfgEnabled: false
    });
    config.lfgEnabled = false;
  }

  const closed = await closeActiveRequestsForEvent(
    config.discordEventId,
    reason
  );

  for (const request of closed) {
    try {
      const user = await client.users.fetch(request.ownerUserId);
      const reasonText =
        reason === "disabled"
          ? "a moderator turned LFG off"
          : "the event has started";

      await user.send(
        `LFG for **${config.eventName}** has closed because ${reasonText}.`
      );
    } catch (err) {
      console.warn(
        `[LFG] expiry DM failed for ${request.ownerUserId}:`,
        err?.message || err
      );
    }
  }

  if (closed.length) {
    console.log(
      `[LFG] closed ${closed.length} request(s) for ${config.eventName} (${reason})`
    );
  }

  return closed;
}

async function reconcileLfgExpiry(client, guild) {
  if (!guild) {
    return;
  }

  const configs = await listLfgEvents({ guildId: guild.id });

  if (!configs.length) {
    return;
  }

  const discordEvents = await fetchGuildScheduledEvents(guild);
  const byId = new Map(discordEvents.map(event => [event.id, event]));

  for (const config of configs) {
    const discordEvent = byId.get(config.discordEventId) || null;

    if (discordEvent?.name && discordEvent.name !== config.eventName) {
      await upsertLfgEvent({
        discordEventId: config.discordEventId,
        eventName: discordEvent.name,
        startTime: discordEvent.scheduledStartAt?.toISOString?.() || config.startTime
      });
    } else if (
      discordEvent?.scheduledStartAt &&
      discordEvent.scheduledStartAt.toISOString() !== config.startTime
    ) {
      await upsertLfgEvent({
        discordEventId: config.discordEventId,
        startTime: discordEvent.scheduledStartAt.toISOString()
      });
    }

    const started = eventHasStarted(config, discordEvent);
    const startPassed =
      config.startTime && Date.parse(config.startTime) <= Date.now();

    if (started || startPassed) {
      await expireLfgEvent(client, config, "event_started");
    }
  }
}

function shortWhenLabel(date) {
  if (!date) {
    return "Time TBD";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.REMINDER_TIMEZONE || "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

async function listOpenLfgEvents(guild) {
  const configs = await listLfgEvents({
    guildId: guild.id,
    enabledOnly: true
  });

  if (!configs.length) {
    return [];
  }

  const discordEvents = await fetchGuildScheduledEvents(guild);
  const byId = new Map(discordEvents.map(event => [event.id, event]));
  const now = Date.now();
  const open = [];

  for (const config of configs) {
    const discordEvent = byId.get(config.discordEventId);

    if (!discordEvent || eventHasStarted(config, discordEvent, now)) {
      continue;
    }

    open.push({
      ...config,
      discordEvent,
      whenLabel: shortWhenLabel(discordEvent.scheduledStartAt)
    });
  }

  return open.sort((a, b) => {
    const aTime =
      a.discordEvent.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime =
      b.discordEvent.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

function startLfgExpiryScheduler(client) {
  if (expiryTimer) {
    return;
  }

  const run = async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        await reconcileLfgExpiry(client, guild);
      } catch (err) {
        console.error(
          `[LFG] expiry reconcile failed guild ${guild.id}:`,
          err?.message || err
        );
      }
    }
  };

  setTimeout(() => {
    run().catch(err => {
      console.error("[LFG] initial expiry reconcile failed:", err?.message || err);
    });
  }, 15_000);

  expiryTimer = setInterval(() => {
    run().catch(err => {
      console.error("[LFG] expiry reconcile failed:", err?.message || err);
    });
  }, CHECK_INTERVAL_MS);

  expiryTimer.unref?.();
  console.log("✅ LFG expiry scheduler started");
}

module.exports = {
  eventHasStarted,
  expireLfgEvent,
  reconcileLfgExpiry,
  listOpenLfgEvents,
  shortWhenLabel,
  startLfgExpiryScheduler
};
