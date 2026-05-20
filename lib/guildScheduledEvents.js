const {
  GuildScheduledEventStatus,
  Routes
} = require("discord.js");

const EVENT_TIMEZONE =
  process.env.REMINDER_TIMEZONE || "Europe/London";

const EVENT_CACHE_MS = 60_000;

/** @type {Map<string, { fetchedAt: number, events: NormalizedScheduledEvent[] }>} */
const scheduledEventCache = new Map();

/**
 * @typedef {object} NormalizedScheduledEvent
 * @property {string} id
 * @property {string} name
 * @property {Date | null} scheduledStartAt
 * @property {number} status
 */

function calendarDayInTimezone(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function isToday(date) {
  if (!date) {
    return false;
  }

  const day = calendarDayInTimezone(date, EVENT_TIMEZONE);
  const today = calendarDayInTimezone(new Date(), EVENT_TIMEZONE);

  return day === today;
}

function isTomorrow(date) {
  if (!date) {
    return false;
  }

  const day = calendarDayInTimezone(date, EVENT_TIMEZONE);
  const tomorrowAnchor = new Date();
  tomorrowAnchor.setDate(tomorrowAnchor.getDate() + 1);
  const tomorrow = calendarDayInTimezone(tomorrowAnchor, EVENT_TIMEZONE);

  return day === tomorrow;
}

function isTodayOrTomorrow(date) {
  return isToday(date) || isTomorrow(date);
}

function normalizeFromRest(raw) {
  if (!raw?.id || !raw?.name) {
    return null;
  }

  return {
    id: String(raw.id),
    name: String(raw.name),
    scheduledStartAt: raw.scheduled_start_time
      ? new Date(raw.scheduled_start_time)
      : null,
    status: Number(raw.status)
  };
}

function normalizeFromManager(event) {
  if (!event?.id || !event?.name) {
    return null;
  }

  return {
    id: event.id,
    name: event.name,
    scheduledStartAt: event.scheduledStartAt ?? null,
    status: event.status
  };
}

function isSelectableEvent(event) {
  return (
    event.status !== GuildScheduledEventStatus.Completed &&
    event.status !== GuildScheduledEventStatus.Cancelled
  );
}

async function fetchGuildScheduledEvents(guild, { force = false } = {}) {
  const guildId = guild?.id;
  const client = guild?.client;

  if (!guildId || !client) {
    return [];
  }

  if (!force) {
    const cached = scheduledEventCache.get(guildId);

    if (cached && Date.now() - cached.fetchedAt < EVENT_CACHE_MS) {
      return cached.events;
    }
  }

  let events = [];

  try {
    const rawList = await client.rest.get(
      Routes.guildScheduledEvents(guildId)
    );

    if (Array.isArray(rawList)) {
      events = rawList.map(normalizeFromRest).filter(Boolean);
    }
  } catch (err) {
    console.error(
      `[EVENTS] REST list failed guild ${guildId}:`,
      err?.code,
      err?.status,
      err?.message || err
    );
  }

  if (events.length === 0 && guild.scheduledEvents) {
    try {
      const collection = await guild.scheduledEvents.fetch({ force: true });
      events = [...collection.values()]
        .map(normalizeFromManager)
        .filter(Boolean);
    } catch (err) {
      console.error(
        `[EVENTS] Manager fetch failed guild ${guildId}:`,
        err?.message || err
      );
    }
  }

  if (events.length === 0 && !guild.scheduledEvents) {
    try {
      const fullGuild = await client.guilds.fetch(guildId);
      const collection = await fullGuild.scheduledEvents.fetch({ force: true });
      events = [...collection.values()]
        .map(normalizeFromManager)
        .filter(Boolean);
    } catch (err) {
      console.error(
        `[EVENTS] Guild refetch failed ${guildId}:`,
        err?.message || err
      );
    }
  }

  scheduledEventCache.set(guildId, {
    fetchedAt: Date.now(),
    events
  });

  console.log(
    `[EVENTS] guild ${guildId}: ${events.length} scheduled event(s) from API`
  );

  return events;
}

async function resolveGuildForEvents(client, interaction) {
  if (interaction.guildId) {
    const cached = client.guilds.cache.get(interaction.guildId);

    if (cached) {
      return cached;
    }

    const fetched = await client.guilds
      .fetch(interaction.guildId)
      .catch(() => null);

    if (fetched) {
      return fetched;
    }
  }

  if (interaction.guild?.id) {
    return interaction.guild;
  }

  return null;
}

function getSelectableScheduledEvents(events, { preferNearTerm = true } = {}) {
  const selectable = events
    .filter(isSelectableEvent)
    .sort((a, b) => {
      const aTime = a.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });

  if (!preferNearTerm) {
    return selectable;
  }

  const todayAndTomorrow = selectable.filter(
    event =>
      event.scheduledStartAt && isTodayOrTomorrow(event.scheduledStartAt)
  );

  if (todayAndTomorrow.length > 0) {
    return todayAndTomorrow;
  }

  const now = Date.now();
  const upcoming = selectable.filter(
    event =>
      !event.scheduledStartAt || event.scheduledStartAt.getTime() >= now
  );

  return upcoming.length > 0 ? upcoming : selectable;
}

function formatChoiceLabel(event) {
  const when = event.scheduledStartAt
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: EVENT_TIMEZONE,
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit"
      }).format(event.scheduledStartAt)
    : "Time TBD";

  return `${event.name} — ${when}`.slice(0, 100);
}

function buildAutocompleteChoices(events, focused) {
  const query = focused.trim().toLowerCase();
  let filtered = events;

  if (query) {
    filtered = events.filter(event =>
      event.name.toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0 && events.length > 0) {
    filtered = events;
  }

  return filtered.slice(0, 25).map(event => ({
    name: formatChoiceLabel(event),
    value: event.id
  }));
}

function formatEventStartTime(date) {
  if (!date) {
    return "TBD";
  }

  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

function formatEventDetails(event) {
  const lines = [];

  if (event.scheduledStartAt) {
    lines.push(`**Starts:** ${formatEventStartTime(event.scheduledStartAt)}`);
  }

  return lines.join("\n");
}

async function resolveScheduledEvent(guild, eventInput) {
  if (!eventInput?.trim() || !guild?.id) {
    return null;
  }

  const eventId = eventInput.trim();
  const client = guild.client;

  const fromCache = scheduledEventCache
    .get(guild.id)
    ?.events?.find(event => event.id === eventId);

  if (fromCache) {
    return fromCache;
  }

  if (guild.scheduledEvents?.cache?.has(eventId)) {
    const cached = guild.scheduledEvents.cache.get(eventId);
    const normalized = normalizeFromManager(cached);

    if (normalized) {
      return normalized;
    }
  }

  try {
    const raw = await client.rest.get(
      Routes.guildScheduledEvent(guild.id, eventId)
    );
    const normalized = normalizeFromRest(raw);

    if (normalized) {
      return normalized;
    }
  } catch (err) {
    console.error(
      `[EVENTS] REST fetch event ${eventId} guild ${guild.id}:`,
      err?.code,
      err?.message || err
    );
  }

  if (guild.scheduledEvents) {
    try {
      const event = await guild.scheduledEvents.fetch(eventId, { force: true });
      const normalized = normalizeFromManager(event);

      if (normalized) {
        return normalized;
      }
    } catch (err) {
      console.error(
        `[EVENTS] Manager fetch event ${eventId}:`,
        err?.message || err
      );
    }
  }

  const allEvents = await fetchGuildScheduledEvents(guild, { force: true });
  const byId = allEvents.find(event => event.id === eventId);

  if (byId) {
    return byId;
  }

  if (!/^\d{17,20}$/.test(eventId)) {
    const query = eventId.toLowerCase();
    const nameMatches = allEvents.filter(event =>
      event.name.toLowerCase().includes(query)
    );

    if (nameMatches.length === 1) {
      return nameMatches[0];
    }
  }

  return null;
}

function formatRulesEventTime(date) {
  if (!date) {
    return "TBD";
  }

  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:F>`;
}

function cacheScheduledEvent(guildId, event) {
  if (!guildId || !event?.id) {
    return;
  }

  const existing = scheduledEventCache.get(guildId)?.events || [];

  scheduledEventCache.set(guildId, {
    fetchedAt: Date.now(),
    events: [
      event,
      ...existing.filter(item => item.id !== event.id)
    ]
  });
}

module.exports = {
  fetchGuildScheduledEvents,
  getSelectableScheduledEvents,
  buildAutocompleteChoices,
  resolveGuildForEvents,
  formatEventDetails,
  formatEventStartTime,
  formatRulesEventTime,
  resolveScheduledEvent,
  cacheScheduledEvent,
  isSelectableEvent
};
