const {
  GuildScheduledEventStatus,
  Routes
} = require("discord.js");

const EVENT_TIMEZONE =
  process.env.REMINDER_TIMEZONE || "Europe/London";

const EVENT_CACHE_MS = 60_000;
const EVENT_CACHE_STALE_MS = 5 * 60_000;
const AUTOCOMPLETE_FETCH_MS = 2_500;

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
  const status = Number(event.status);

  if (!Number.isFinite(status)) {
    return true;
  }

  return (
    status !== GuildScheduledEventStatus.Completed &&
    status !== GuildScheduledEventStatus.Cancelled
  );
}

function sortEventsByStart(events) {
  return [...events].sort((a, b) => {
    const aTime = a.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = b.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });
}

function getEventsForAutocomplete(events) {
  return sortEventsByStart(
    events.filter(event => event?.id && event?.name)
  );
}

function peekScheduledEventsCache(guildId, maxAgeMs = EVENT_CACHE_MS) {
  const cached = scheduledEventCache.get(guildId);

  if (!cached || Date.now() - cached.fetchedAt > maxAgeMs) {
    return null;
  }

  return cached.events;
}

async function listScheduledEventsFromRest(guild) {
  const guildId = guild?.id;
  const client = guild?.client;

  if (!guildId || !client) {
    return [];
  }

  try {
    const rawList = await client.rest.get(
      Routes.guildScheduledEvents(guildId)
    );

    if (Array.isArray(rawList)) {
      return rawList.map(normalizeFromRest).filter(Boolean);
    }

    if (rawList && typeof rawList === "object") {
      console.warn(
        `[EVENTS] REST list guild ${guildId} returned non-array:`,
        Object.keys(rawList)
      );
    }
  } catch (err) {
    console.error(
      `[EVENTS] REST list failed guild ${guildId}:`,
      err?.code,
      err?.status,
      err?.message || err,
      err?.rawError ? JSON.stringify(err.rawError) : ""
    );
  }

  return [];
}

async function fetchGuildScheduledEvents(
  guild,
  { force = false, quickOnly = false } = {}
) {
  const guildId = guild?.id;
  const client = guild?.client;

  if (!guildId || !client) {
    return [];
  }

  if (!force) {
    const cached = peekScheduledEventsCache(guildId);

    if (cached) {
      return cached;
    }
  }

  let events = await listScheduledEventsFromRest(guild);

  if (quickOnly) {
    scheduledEventCache.set(guildId, {
      fetchedAt: Date.now(),
      events
    });

    return events;
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
  if (interaction.guild?.id) {
    return interaction.guild;
  }

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

  return null;
}

function scheduleEventCacheRefresh(guild) {
  if (!guild?.id) {
    return;
  }

  void fetchGuildScheduledEvents(guild, { force: true }).catch(err => {
    console.error(
      `[EVENTS] background refresh failed guild ${guild.id}:`,
      err?.message || err
    );
  });
}

async function respondScheduledEventAutocomplete(interaction, focusedValue = "") {
  const guild = await resolveGuildForEvents(interaction.client, interaction);

  if (!guild) {
    if (!interaction.responded) {
      await interaction.respond([]);
    }

    return;
  }

  const cached =
    peekScheduledEventsCache(guild.id) ||
    peekScheduledEventsCache(guild.id, EVENT_CACHE_STALE_MS);

  if (cached?.length) {
    const choices = buildAutocompleteChoices(
      getEventsForAutocomplete(cached),
      focusedValue
    );

    if (!interaction.responded) {
      await interaction.respond(choices);
    }

    scheduleEventCacheRefresh(guild);
    return;
  }

  let events = [];

  try {
    events = await Promise.race([
      fetchGuildScheduledEvents(guild, { force: true, quickOnly: true }),
      new Promise(resolve => {
        setTimeout(() => resolve(null), AUTOCOMPLETE_FETCH_MS);
      })
    ]);
  } catch (err) {
    console.error(
      `[EVENTS] autocomplete fetch guild ${guild.id}:`,
      err?.message || err
    );
  }

  if (!events) {
    events =
      peekScheduledEventsCache(guild.id, EVENT_CACHE_STALE_MS) ||
      (await listScheduledEventsFromRest(guild).catch(() => [])) ||
      [];
    scheduleEventCacheRefresh(guild);
  }

  const choices = buildAutocompleteChoices(
    getEventsForAutocomplete(events),
    focusedValue
  );

  if (!interaction.responded) {
    await interaction.respond(choices);
  }
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
  peekScheduledEventsCache,
  scheduleEventCacheRefresh,
  respondScheduledEventAutocomplete,
  getSelectableScheduledEvents,
  getEventsForAutocomplete,
  buildAutocompleteChoices,
  resolveGuildForEvents,
  formatEventDetails,
  formatEventStartTime,
  formatRulesEventTime,
  resolveScheduledEvent,
  cacheScheduledEvent,
  isSelectableEvent
};
