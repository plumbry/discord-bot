const {
  POST_FILL_TYPE,
  POST_NEED_TYPE,
  getLfgEvent,
  getLfgRequest,
  updateLfgRequest,
  listOpenPostRequests
} = require("./lfgSheet");

const { readPlayerProfile } = require("./lfgEligibility");

const { fillMatchDm } = require("./lfgPostUi");

const eventLocks = new Map();

function withEventLock(eventId, fn) {
  const previous = eventLocks.get(eventId) || Promise.resolve();
  let release;
  const next = new Promise(resolve => {
    release = resolve;
  });

  eventLocks.set(
    eventId,
    previous.then(() => next, () => next)
  );

  return previous
    .catch(() => {})
    .then(fn)
    .finally(() => {
      release();
    });
}

function fillMatchesNeed(profile, need) {
  if (!profile?.ok || !need?.active || need.status === "CLOSED") {
    return false;
  }

  if (profile.userId === need.ownerUserId) {
    return false;
  }

  const accepted = (need.acceptedTiers || []).map(tier =>
    String(tier).toUpperCase()
  );

  if (!accepted.includes(String(profile.tier).toUpperCase())) {
    return false;
  }

  const required = String(need.requiredGender || "").toLowerCase();

  if (required !== "either" && profile.gender !== required) {
    return false;
  }

  return true;
}

async function sendDm(client, userId, payload) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(payload);
    return true;
  } catch (err) {
    console.warn(
      `[LFGPOST] DM failed for ${userId}:`,
      err?.message || err
    );
    return false;
  }
}

async function liveFillProfile(guild, fill) {
  const profile = await readPlayerProfile(guild, fill.ownerUserId);

  if (!profile.ok) {
    return null;
  }

  return profile;
}

async function notifyNeedAboutFill(client, need, profile) {
  if ((need.notifiedFillUserIds || []).includes(profile.userId)) {
    return false;
  }

  const sent = await sendDm(client, need.ownerUserId, {
    content: fillMatchDm({
      tier: profile.tier,
      gender: profile.gender,
      fillUserId: profile.userId
    }),
    allowedMentions: { users: [profile.userId] }
  });

  if (!sent) {
    return false;
  }

  await updateLfgRequest(need.id, {
    notifiedFillUserIds: [
      ...new Set([...(need.notifiedFillUserIds || []), profile.userId])
    ]
  });

  return true;
}

async function matchFillAgainstOpenNeeds(guild, eventId, fill) {
  const eventConfig = await getLfgEvent(eventId);

  if (!guild || !eventConfig?.lfgEnabled || fill?.type !== POST_FILL_TYPE) {
    return [];
  }

  return withEventLock(eventId, async () => {
    const profile = await liveFillProfile(guild, fill);

    if (!profile) {
      return [];
    }

    const needs = await listOpenPostRequests(eventId, POST_NEED_TYPE);
    const notified = [];

    for (const need of needs) {
      const liveNeed = await getLfgRequest(need.id);

      if (!fillMatchesNeed(profile, liveNeed)) {
        continue;
      }

      const ok = await notifyNeedAboutFill(guild.client, liveNeed, profile);

      if (ok) {
        notified.push(liveNeed.ownerUserId);
      }
    }

    return notified;
  });
}

async function matchNeedAgainstOpenFills(guild, eventId, need) {
  const eventConfig = await getLfgEvent(eventId);

  if (!guild || !eventConfig?.lfgEnabled || need?.type !== POST_NEED_TYPE) {
    return [];
  }

  return withEventLock(eventId, async () => {
    const liveNeed = await getLfgRequest(need.id);

    if (!liveNeed?.active) {
      return [];
    }

    const fills = await listOpenPostRequests(eventId, POST_FILL_TYPE);
    const notified = [];

    for (const fill of fills) {
      const profile = await liveFillProfile(guild, fill);

      if (!profile || !fillMatchesNeed(profile, liveNeed)) {
        continue;
      }

      const refreshed = await getLfgRequest(liveNeed.id);

      if (!fillMatchesNeed(profile, refreshed)) {
        continue;
      }

      const ok = await notifyNeedAboutFill(guild.client, refreshed, profile);

      if (ok) {
        notified.push(profile.userId);
      }
    }

    return notified;
  });
}

module.exports = {
  fillMatchesNeed,
  matchFillAgainstOpenNeeds,
  matchNeedAgainstOpenFills,
  sendPostDm: sendDm
};
