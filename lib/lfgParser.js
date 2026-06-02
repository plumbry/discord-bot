const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
];

const TODAY_WHEN = /\b(today|tonight|tdy)\b/i;
const TOMORROW_WHEN = /\b(tmr|tomorrow)\b/i;
const FOR_TODAY = /\bfor\s+(?:today|tdy|tonight)\b/i;

const FILL_OFFER_PATTERN =
  /\b(can|could|will|i'?ll|happy\s+to|down\s+to)\s+fill\b|\bfill\s+in\b|\bfill\s+if\b|\bif\s+(anyone|anybody|someone)\s+needs?\s+\d+/i;

/** e.g. "need 3 tdy any tier" — offering to join teams that need 3 today */
const NEED_SLOTS_TODAY_FILL_PATTERN =
  /\bneed(?:s)?\s+(\d+)\s+(?:tdy|today|tonight)\b/i;

/** Recruiting despite already having signup role (e.g. "need fill"). */
const NEED_FILL_PATTERN = /\bneed(?:s)?\s+(?:a\s+)?fill\b/i;

const LFG_DAY_START_HOUR_UTC = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isFillOffer(text) {
  return (
    FILL_OFFER_PATTERN.test(text) ||
    NEED_SLOTS_TODAY_FILL_PATTERN.test(text)
  );
}

function isNeedFill(text) {
  return NEED_FILL_PATTERN.test(text);
}

function hasExplicitWhen(text) {
  const lower = text.toLowerCase();

  if (TODAY_WHEN.test(lower) || TOMORROW_WHEN.test(lower) || FOR_TODAY.test(lower)) {
    return true;
  }

  return WEEKDAYS.some(day => new RegExp(`\\b${day}\\b`, "i").test(lower));
}

/** Recruiting post with no day named → treat as tonight/today (not fill, not tmr). */
function isRecruitingPost(text) {
  if (isFillOffer(text)) {
    return false;
  }

  const lower = text.toLowerCase();

  if (TOMORROW_WHEN.test(lower)) {
    return false;
  }

  return (
    /\bneed(?:s)?\s+(?:[1-3]|\d+)\b/.test(lower) ||
    /\bn[1-3]\b/.test(lower) ||
    /\blf[1-3]\b/.test(lower) ||
    /\blf\s*[1-3]\b/.test(lower) ||
    /\bneed\s+a\s+(?:[sabc]\s+)?tier\b/.test(lower) ||
    /\bneed\s+a\s+tier\s+[sabc]\b/.test(lower) ||
    /\bneed\s+a\s+(?:girl|guy|boy|woman|man)\b/.test(lower) ||
    /\bneed\s+a\s+(?:[sabc]\s+)?tier\s+(?:girl|guy|boy|girls?|guys?|boys?|woman|women|man|men)\b/.test(
      lower
    ) ||
    /\blooking\s+for\s+(?:[1-3]|\d+|duo|trio|squad)\b/.test(lower) ||
    /\blfg\b/.test(lower) ||
    /\+[1-3]\b/.test(lower)
  );
}

function parseSlotsNeeded(text) {
  if (isFillOffer(text)) {
    return null;
  }

  if (/\bneed(?:s)?\s+(?:a\s+)?teammates?\b/i.test(text)) {
    return 1;
  }

  if (
    /\bneed\s+a\s+(?:[sabc]\s+)?tier\b/i.test(text) ||
    /\bneed\s+a\s+tier\s+[sabc]\b/i.test(text) ||
    /\bneed\s+a\s+(?:girl|guy|boy|woman|man)\b/i.test(text) ||
    /\bneed\s+a\s+(?:[sabc]\s+)?tier\s+(?:girl|guy|boy|girls?|guys?|boys?|woman|women|man|men)\b/i.test(
      text
    )
  ) {
    return 1;
  }

  const nShorthand = text.match(/\bn([1-3])\b/i);

  if (nShorthand) {
    return Number.parseInt(nShorthand[1], 10);
  }

  const lfShorthand = text.match(/\blf([1-3])\b/i);

  if (lfShorthand) {
    return Number.parseInt(lfShorthand[1], 10);
  }

  const patterns = [
    /\bneed(?:s)?\s+(\d+)\b/i,
    /\blooking\s+for\s+(\d+)\b/i,
    /\blfg\s+(\d+)\b/i,
    /\blf\s+(\d+)\b/i,
    /\b(\d+)\s+for\s+(?:tmr|tomorrow|today|tonight|tdy)\b/i,
    /\bfor\s+(\d+)\b/i,
    /\+(\d+)\b/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      const n = Number.parseInt(match[1], 10);

      if (n >= 1 && n <= 3) {
        return n;
      }
    }
  }

  if (/\b(duo|duos|2s|2-man)\b/i.test(text)) {
    return 1;
  }

  if (/\b(trio|trios|3s|3-man)\b/i.test(text)) {
    return 2;
  }

  if (/\b(squad|squads|4s|4-man)\b/i.test(text)) {
    return 3;
  }

  return null;
}

function parseTierNeeds(text) {
  const found = new Set();
  const lower = text.toLowerCase();

  if (/\bany\s+tier\b/i.test(lower)) {
    return null;
  }

  const needSlotTierGender = lower.match(
    /\bneed(?:s)?\s+(?:[1-3]|\d+)\s+([sabc])\s+(?:tier\s+)?(?:girl|guy|boy|girls?|guys?|boys?)\b/
  );

  if (needSlotTierGender) {
    found.add(needSlotTierGender[1].toUpperCase());
  }

  for (const tier of ["s", "a", "b", "c"]) {
    if (
      new RegExp(`\\b${tier}\\s*tiers?\\b`, "i").test(lower) ||
      new RegExp(`\\btier\\s+${tier}s?\\b`, "i").test(lower) ||
      new RegExp(`\\b${tier}\\+\\b`, "i").test(lower) ||
      new RegExp(`\\b${tier}\\s+only\\b`, "i").test(lower)
    ) {
      found.add(tier.toUpperCase());
      continue;
    }

    if (tier !== "a" && new RegExp(`\\bneed(?:s)?\\s+${tier}\\b`, "i").test(lower)) {
      found.add(tier.toUpperCase());
    }
  }

  if (found.size === 0) {
    return null;
  }

  return [...found].sort().join("/");
}

function parseGenderNeed(text) {
  const lower = text.toLowerCase();

  const wantsGirl =
    /\b(girls?|females?|women|ladies)\b/.test(lower);

  const wantsBoy =
    /\b(boys?|males?|men|guy|guys)\b/.test(lower);

  if (wantsGirl && !wantsBoy) {
    return "girl";
  }

  if (wantsBoy && !wantsGirl) {
    return "guy";
  }

  return null;
}

function formatWantsPhrase(tierNeed, genderNeed) {
  if (!tierNeed && !genderNeed) {
    return null;
  }

  if (tierNeed && genderNeed) {
    return `${tierNeed} tier ${genderNeed}`;
  }

  if (tierNeed) {
    return `${tierNeed} tier`;
  }

  return genderNeed;
}

function startOfLogicalDayUtc(date) {
  const d = new Date(date);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth();
  let day = d.getUTCDate();

  if (d.getUTCHours() < LFG_DAY_START_HOUR_UTC) {
    const prev = new Date(Date.UTC(year, month, day));
    prev.setUTCDate(prev.getUTCDate() - 1);
    year = prev.getUTCFullYear();
    month = prev.getUTCMonth();
    day = prev.getUTCDate();
  }

  return Date.UTC(year, month, day, LFG_DAY_START_HOUR_UTC, 0, 0, 0);
}

function addLogicalDays(date, days) {
  return startOfLogicalDayUtc(date) + days * MS_PER_DAY;
}

function logicalWeekdayUtc(date) {
  const midday = startOfLogicalDayUtc(date) + 12 * MS_PER_DAY;
  return new Date(midday).getUTCDay();
}

function resolveWhenBucket(targetWhenMs, referenceNow = new Date()) {
  if (targetWhenMs === Number.MAX_SAFE_INTEGER) {
    return null;
  }

  const targetDay = startOfLogicalDayUtc(new Date(targetWhenMs));
  const today = startOfLogicalDayUtc(referenceNow);

  if (targetDay === today) {
    return { label: "Today", whenSortKey: 0 };
  }

  return null;
}

function parseWhenLabel(
  text,
  scheduledEvents = [],
  messagePostedAt = new Date(),
  referenceNow = new Date()
) {
  const lower = text.toLowerCase();

  if (TOMORROW_WHEN.test(lower)) {
    return {
      label: "Tomorrow",
      sortKey: addLogicalDays(referenceNow, 1)
    };
  }

  if (TODAY_WHEN.test(lower) || FOR_TODAY.test(lower)) {
    return {
      label: "Today / Tonight",
      sortKey: startOfLogicalDayUtc(referenceNow)
    };
  }

  for (let i = 0; i < WEEKDAYS.length; i++) {
    const name = WEEKDAYS[i];

    if (!new RegExp(`\\b${name}\\b`, "i").test(lower)) {
      continue;
    }

    const current = logicalWeekdayUtc(referenceNow);
    let delta = i - current;

    if (delta < 0) {
      delta += 7;
    }

    const label =
      name.charAt(0).toUpperCase() + name.slice(1);

    return {
      label,
      sortKey: addLogicalDays(referenceNow, delta)
    };
  }

  const events = [...scheduledEvents]
    .filter(event => event.name)
    .sort((a, b) => {
      const aTime = a.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });

  if (!hasExplicitWhen(text)) {
    for (const event of events) {
      const eventName = event.name.toLowerCase();

      if (eventName.length >= 4 && lower.includes(eventName)) {
        const start = event.scheduledStartAt;

        return {
          label: event.name,
          sortKey: start ? startOfLogicalDayUtc(start) : Number.MAX_SAFE_INTEGER
        };
      }
    }
  }

  if (
    !hasExplicitWhen(text) &&
    (isFillOffer(text) || isRecruitingPost(text))
  ) {
    return {
      label: "Today / Tonight",
      sortKey: startOfLogicalDayUtc(referenceNow)
    };
  }

  return {
    label: "Unspecified",
    sortKey: Number.MAX_SAFE_INTEGER
  };
}

function parseLfgMessage(
  text,
  scheduledEvents = [],
  messagePostedAt = new Date(),
  referenceNow = new Date()
) {
  const fillOffer = isFillOffer(text);
  const needFill = isNeedFill(text);
  const slotsNeeded = parseSlotsNeeded(text);
  const when = parseWhenLabel(
    text,
    scheduledEvents,
    messagePostedAt,
    referenceNow
  );

  const bucket = resolveWhenBucket(when.sortKey, referenceNow);

  if (!bucket) {
    return null;
  }

  const tierNeed = parseTierNeeds(text);
  const genderNeed = parseGenderNeed(text);

  return {
    fillOffer,
    needFill,
    slotsNeeded,
    whenLabel: bucket.label,
    whenSortKey: bucket.whenSortKey,
    tierNeed,
    genderNeed
  };
}

function formatEntryLine({
  username,
  tier,
  gender,
  fillOffer,
  slotsNeeded,
  tierNeed,
  genderNeed
}) {
  const parts = [`**${username}**`];

  const profile = [];

  if (fillOffer) {
    if (tier) {
      profile.push(`**${tier}** tier`);
    }

    if (gender) {
      profile.push(gender);
    }

    if (profile.length > 0) {
      parts.push(`(${profile.join(" · ")})`);
    }
  }

  if (fillOffer) {
    parts.push("— available to fill");
  } else if (slotsNeeded != null) {
    parts.push(`— looking for **${slotsNeeded}** teammate(s)`);
  } else {
    parts.push("— looking for teammate(s)");
  }

  const wantsPhrase = formatWantsPhrase(tierNeed, genderNeed);

  if (wantsPhrase) {
    parts.push(`· needs **${wantsPhrase}**`);
  }

  return parts.join(" ");
}

function compareLfgEntries(a, b) {
  if (a.whenSortKey !== b.whenSortKey) {
    return a.whenSortKey - b.whenSortKey;
  }

  const aFill = a.fillOffer ? 1 : 0;
  const bFill = b.fillOffer ? 1 : 0;

  if (aFill !== bFill) {
    return aFill - bFill;
  }

  return String(a.line).localeCompare(String(b.line), undefined, {
    sensitivity: "base"
  });
}

function buildLfgListMessage(entries) {
  if (entries.length === 0) {
    return "No LFG posts found in recent messages.";
  }

  const sorted = [...entries].sort(compareLfgEntries);
  const daySections = [];
  let currentKey = null;
  let currentLabel = "";
  let currentBullets = [];

  for (const entry of sorted) {
    if (entry.whenSortKey !== currentKey) {
      if (currentBullets.length > 0) {
        daySections.push({
          label: currentLabel,
          bullets: currentBullets
        });
      }

      currentKey = entry.whenSortKey;
      currentLabel = entry.whenLabel;
      currentBullets = [`• ${entry.line}`];
      continue;
    }

    currentBullets.push(`• ${entry.line}`);
  }

  if (currentBullets.length > 0) {
    daySections.push({ label: currentLabel, bullets: currentBullets });
  }

  return daySections
    .map(section => `### ${section.label}\n${section.bullets.join("\n")}`)
    .join("\n\n");
}

const MESSAGE_MAX_AGE_MS = 72 * 60 * 60 * 1000;

module.exports = {
  MESSAGE_MAX_AGE_MS,
  resolveWhenBucket,
  isNeedFill,
  parseLfgMessage,
  formatEntryLine,
  buildLfgListMessage
};
