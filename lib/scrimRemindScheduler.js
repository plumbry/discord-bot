const SCHEDULE_LABELS = {
  now: "Send now",
  "60": "1 hour before event",
  "120": "2 hours before event",
  "180": "3 hours before event",
  "240": "4 hours before event",
  "360": "6 hours before event",
  "720": "12 hours before event",
  "1440": "24 hours before event"
};

function formatTimestamp(date) {
  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

function getScheduleLabel(scheduleValue) {
  return SCHEDULE_LABELS[scheduleValue || "now"] || scheduleValue;
}

/**
 * @param {Date | null} eventStart
 * @param {string | null} scheduleValue
 */
function resolveReminderSendTime(eventStart, scheduleValue) {
  if (!scheduleValue || scheduleValue === "now") {
    return { sendAt: Date.now(), isScheduled: false };
  }

  const minutesBefore = Number.parseInt(scheduleValue, 10);

  if (!Number.isFinite(minutesBefore) || minutesBefore <= 0) {
    return { sendAt: Date.now(), isScheduled: false };
  }

  if (!eventStart) {
    return {
      error:
        "This event has no start time, so it cannot be scheduled. " +
        "Leave **schedule** empty to post immediately."
    };
  }

  const sendAt = eventStart.getTime() - minutesBefore * 60 * 1000;

  if (sendAt <= Date.now()) {
    return {
      sendAt: Date.now(),
      isScheduled: false,
      postedEarly: true,
      plannedSendAt: sendAt
    };
  }

  return { sendAt, isScheduled: true };
}

module.exports = {
  SCHEDULE_LABELS,
  formatTimestamp,
  getScheduleLabel,
  resolveReminderSendTime
};
