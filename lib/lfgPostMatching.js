const {
  POST_FILL_TYPE,
  POST_NEED_TYPE,
  getLfgEvent,
  getLfgRequest,
  updateLfgRequest,
  listOpenPostRequests,
  listLfgEvents,
  getActivePostRequest,
  closeLfgRequest,
  isLfgPostOpen
} = require("./lfgSheet");

const { readPlayerProfile } = require("./lfgEligibility");

const { fillMatchDm, needNotifyStopRows } = require("./lfgPostUi");

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

function memberHasExcludeRole(member, eventConfig) {
  const roleId = eventConfig?.excludeRoleId;

  if (!roleId || !member?.roles?.cache) {
    return false;
  }

  return member.roles.cache.has(roleId);
}

async function closeFillIfExcluded(guild, eventConfig, fill) {
  if (!eventConfig?.excludeRoleId || !fill?.id) {
    return false;
  }

  const member =
    guild.members.cache.get(fill.ownerUserId) ||
    (await guild.members.fetch(fill.ownerUserId).catch(() => null));

  if (!memberHasExcludeRole(member, eventConfig)) {
    return false;
  }

  await closeLfgRequest(fill.id, "has_event_role");
  return true;
}

async function handleLfgPostRoleGained(oldMember, newMember) {
  if (!newMember?.guild || newMember.user?.bot) {
    return;
  }

  const oldRoleIds = new Set(oldMember?.roles?.cache?.keys?.() || []);
  const gainedRoleIds = [...(newMember.roles?.cache?.keys?.() || [])].filter(
    roleId => !oldRoleIds.has(roleId)
  );

  if (!gainedRoleIds.length) {
    return;
  }

  const events = await listLfgEvents({
    guildId: newMember.guild.id,
    enabledOnly: true
  });

  for (const event of events) {
    if (!event.excludeRoleId || !gainedRoleIds.includes(event.excludeRoleId)) {
      continue;
    }

    const fill = await getActivePostRequest(
      event.discordEventId,
      newMember.id,
      POST_FILL_TYPE
    );

    if (fill) {
      await closeLfgRequest(fill.id, "has_event_role");
    }
  }
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
      displayName:
        profile.member?.displayName ||
        profile.member?.user?.globalName ||
        profile.member?.user?.username
    }),
    components: needNotifyStopRows(need.id)
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

  if (!guild || !isLfgPostOpen(eventConfig) || fill?.type !== POST_FILL_TYPE) {
    return [];
  }

  return withEventLock(eventId, async () => {
    if (await closeFillIfExcluded(guild, eventConfig, fill)) {
      return [];
    }

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

  if (!guild || !isLfgPostOpen(eventConfig) || need?.type !== POST_NEED_TYPE) {
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
      if (await closeFillIfExcluded(guild, eventConfig, fill)) {
        continue;
      }

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
  memberHasExcludeRole,
  matchFillAgainstOpenNeeds,
  matchNeedAgainstOpenFills,
  handleLfgPostRoleGained,
  sendPostDm: sendDm
};
