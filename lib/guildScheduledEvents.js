const { GuildScheduledEventStatus } = require("discord.js");

const EVENT_TIMEZONE =
  process.env.REMINDER_TIMEZONE || "Europe/London";

const EVENT_CACHE_MS = 60_000;

/** @type {Map<string, { fetchedAt: number, events: import("discord.js").GuildScheduledEvent[] }>} */
const scheduledEventCache = new Map();

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

function isSelectableEvent(event) {
  return (
    event.status !== GuildScheduledEventStatus.Completed &&
    event.status !== GuildScheduledEventStatus.Cancelled
  );
}

async function fetchGuildScheduledEvents(guild, { force = false } = {}) {
  const cached = scheduledEventCache.get(guild.id);

  if (!force && cached && Date.now() - cached.fetchedAt < EVENT_CACHE_MS) {
    return cached.events;
  }

  const collection = await guild.scheduledEvents.fetch();
  const events = [...collection.values()];

  scheduledEventCache.set(guild.id, {
    fetchedAt: Date.now(),
    events
  });

  return events;
}

function getSelectableScheduledEvents(events) {
  const selectable = events
    .filter(isSelectableEvent)
    .sort((a, b) => {
      const aTime = a.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });

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

/** Event details under the ## {name} LFG title (no heading). */
function formatEventDetails(event) {
  const lines = [];

  if (event.scheduledStartAt) {
    lines.push(`**Starts:** ${formatEventStartTime(event.scheduledStartAt)}`);
  }

  return lines.join("\n");
}

async function resolveScheduledEvent(guild, eventId) {
  if (!eventId) {
    return null;
  }

  const cached = scheduledEventCache
    .get(guild.id)
    ?.events?.find(event => event.id === eventId);

  if (cached) {
    return cached;
  }

  try {
    return await guild.scheduledEvents.fetch(eventId);
  } catch {
    return null;
  }
}

function formatRulesEventTime(date) {
  if (!date) {
    return "TBD";
  }

  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:F>`;
}

module.exports = {
  fetchGuildScheduledEvents,
  getSelectableScheduledEvents,
  buildAutocompleteChoices,
  formatEventDetails,
  formatEventStartTime,
  formatRulesEventTime,
  resolveScheduledEvent
};
