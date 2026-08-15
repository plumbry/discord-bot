const {
  listActiveRequests,
  upsertLfgMatch,
  updateLfgMatch,
  getLfgMatch,
  getLfgRequest,
  closeLfgRequest,
  hasDismissedMatch,
  findMatchByUsers
} = require("./lfgSheet");

const {
  readPlayerProfiles,
  validateGroup
} = require("./lfgEligibility");

const {
  possibleTeamDm,
  matchActionRows,
  interestedNotifyContent,
  confirmedMatchContent,
  stoppedLookingContent
} = require("./lfgUi");

const NOTIFY_COOLDOWN_MS = 5 * 60 * 1000;
const eventLocks = new Map();
const lastNotifyAt = new Map();

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

function combinations(items, k) {
  const result = [];

  function rec(start, chosen) {
    if (chosen.length === k) {
      result.push([...chosen]);
      return;
    }

    for (let i = start; i < items.length; i++) {
      chosen.push(items[i]);
      rec(i + 1, chosen);
      chosen.pop();
    }
  }

  rec(0, []);
  return result;
}

function usersOverlap(requests) {
  const seen = new Set();

  for (const request of requests) {
    for (const userId of request.memberUserIds) {
      if (seen.has(userId)) {
        return true;
      }

      seen.add(userId);
    }
  }

  return false;
}

function combinedUserIds(requests) {
  return requests.flatMap(request => request.memberUserIds);
}

function oldestCreatedAt(requests) {
  return Math.min(
    ...requests.map(request => Date.parse(request.createdAt) || Date.now())
  );
}

function groupBySize(requests) {
  const bySize = { 1: [], 2: [], 3: [] };

  for (const request of requests) {
    const size = request.memberUserIds.length;

    if (bySize[size]) {
      bySize[size].push(request);
    }
  }

  return bySize;
}

function collectRequestGroups(teamSize, bySize) {
  const groups = [];

  const pushIfValid = combo => {
    if (!combo.length || usersOverlap(combo)) {
      return;
    }

    groups.push(combo);
  };

  if (teamSize === 2) {
    for (const combo of combinations(bySize[1], 2)) {
      pushIfValid(combo);
    }
  }

  if (teamSize === 3) {
    for (const combo of combinations(bySize[1], 3)) {
      pushIfValid(combo);
    }

    for (const pair of bySize[2]) {
      for (const solo of bySize[1]) {
        pushIfValid([pair, solo]);
      }
    }

    for (const combo of combinations(bySize[1], 2)) {
      pushIfValid(combo);
    }
  }

  if (teamSize === 4) {
    for (const combo of combinations(bySize[1], 4)) {
      pushIfValid(combo);
    }

    for (const pair of bySize[2]) {
      for (const solos of combinations(bySize[1], 2)) {
        pushIfValid([pair, ...solos]);
      }

      for (const solo of bySize[1]) {
        pushIfValid([pair, solo]);
      }
    }

    for (const combo of combinations(bySize[2], 2)) {
      pushIfValid(combo);
    }

    for (const trio of bySize[3]) {
      for (const solo of bySize[1]) {
        pushIfValid([trio, solo]);
      }
    }

    for (const combo of combinations(bySize[1], 3)) {
      pushIfValid(combo);
    }

    for (const combo of combinations(bySize[1], 2)) {
      pushIfValid(combo);
    }
  }

  return groups;
}

function candidateFromRequests(requests, profilesByUser, eventConfig) {
  const userIds = combinedUserIds(requests);
  const profiles = userIds.map(userId => profilesByUser.get(userId));

  if (profiles.some(profile => !profile)) {
    return null;
  }

  const result = validateGroup(profiles, {
    format: eventConfig.format,
    teamSize: eventConfig.teamSize,
    tierRuleId: eventConfig.tierRuleId,
    requireComplete: false
  });

  if (!result.ok) {
    return null;
  }

  return {
    requestIds: requests.map(request => request.id).sort(),
    requests,
    userIds: [...userIds].sort(),
    complete: result.complete,
    oldestCreatedAt: oldestCreatedAt(requests),
    size: userIds.length,
    girlCount: result.girlCount,
    boyCount: result.boyCount,
    tiers: result.tiers
  };
}

function sortCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    if (a.complete !== b.complete) {
      return a.complete ? -1 : 1;
    }

    if (a.size !== b.size) {
      return b.size - a.size;
    }

    return a.oldestCreatedAt - b.oldestCreatedAt;
  });
}

async function loadValidRequests(guild, eventConfig) {
  const requests = await listActiveRequests(eventConfig.discordEventId);
  const userIds = [...new Set(requests.flatMap(request => request.memberUserIds))];
  const profiles = await readPlayerProfiles(guild, userIds);
  const profilesByUser = new Map();
  const invalidUsers = new Set();

  for (const profile of profiles) {
    profilesByUser.set(profile.userId, profile);

    if (!profile.ok) {
      invalidUsers.add(profile.userId);
    }
  }

  const validRequests = requests.filter(
    request =>
      request.dmOk &&
      request.memberUserIds.every(userId => !invalidUsers.has(userId))
  );

  return { requests: validRequests, profilesByUser, allRequests: requests };
}

async function findMatchCandidates(guild, eventConfig) {
  const { requests, profilesByUser } = await loadValidRequests(
    guild,
    eventConfig
  );

  if (requests.length < 2) {
    return [];
  }

  const bySize = groupBySize(requests);
  const groups = collectRequestGroups(eventConfig.teamSize, bySize);
  const seen = new Set();
  const candidates = [];

  for (const group of groups) {
    if (group.length < 2) {
      continue;
    }

    const key = group
      .map(request => request.id)
      .sort()
      .join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const candidate = candidateFromRequests(
      group,
      profilesByUser,
      eventConfig
    );

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return sortCandidates(candidates);
}

function notesByOwner(requests) {
  const map = new Map();

  for (const request of requests) {
    if (request.note) {
      map.set(request.ownerUserId, request.note);
    }
  }

  return map;
}

function additionAndCurrent(candidate, request) {
  const current = new Set(request.memberUserIds);
  const adding = candidate.userIds.filter(userId => !current.has(userId));

  return {
    currentUserIds: request.memberUserIds,
    addingUserIds: adding
  };
}

async function sendDm(client, userId, payload) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(payload);
    return true;
  } catch (err) {
    console.warn(
      `[LFG] DM failed for ${userId}:`,
      err?.message || err
    );
    return false;
  }
}

async function notifyCandidate(client, eventConfig, candidate) {
  const existing = await findMatchByUsers(
    eventConfig.discordEventId,
    candidate.userIds
  );

  if (existing?.status === "dead") {
    return existing;
  }

  const match = await upsertLfgMatch({
    eventId: eventConfig.discordEventId,
    requestIds: candidate.requestIds,
    userIds: candidate.userIds,
    complete: candidate.complete,
    status: "proposed"
  });

  const noteByUserId = notesByOwner(candidate.requests);
  const notified = [...match.notifiedOwnerIds];

  for (const request of candidate.requests) {
    if (match.dismissedOwnerIds.includes(request.ownerUserId)) {
      continue;
    }

    if (match.notifiedOwnerIds.includes(request.ownerUserId)) {
      continue;
    }

    const lastAt = lastNotifyAt.get(request.id) || 0;

    if (Date.now() - lastAt < NOTIFY_COOLDOWN_MS) {
      continue;
    }

    const { currentUserIds, addingUserIds } = additionAndCurrent(
      candidate,
      request
    );

    const content = possibleTeamDm({
      eventName: eventConfig.eventName,
      ownerUserId: request.ownerUserId,
      userIds: candidate.userIds,
      addingUserIds,
      currentUserIds,
      noteByUserId
    });

    const sent = await sendDm(client, request.ownerUserId, {
      content,
      components: matchActionRows(match.id, request.id),
      allowedMentions: { users: candidate.userIds }
    });

    if (sent) {
      notified.push(request.ownerUserId);
      lastNotifyAt.set(request.id, Date.now());
    }
  }

  if (notified.length !== match.notifiedOwnerIds.length) {
    await updateLfgMatch(match.id, {
      notifiedOwnerIds: [...new Set(notified)]
    });
  }

  return match;
}

function pickAssignments(candidates) {
  const assigned = new Map();

  for (const candidate of candidates) {
    if (candidate.requests.some(request => assigned.has(request.id))) {
      continue;
    }

    for (const request of candidate.requests) {
      assigned.set(request.id, candidate);
    }
  }

  return assigned;
}

async function recalculateMatches(guild, eventConfig) {
  if (!guild || !eventConfig?.lfgEnabled) {
    return [];
  }

  return withEventLock(eventConfig.discordEventId, async () => {
    const candidates = await findMatchCandidates(guild, eventConfig);

    if (!candidates.length) {
      return [];
    }

    const { requests } = await loadValidRequests(guild, eventConfig);
    const usable = [];

    for (const candidate of candidates) {
      let dismissed = false;

      for (const request of candidate.requests) {
        if (await hasDismissedMatch(request, candidate.userIds)) {
          dismissed = true;
          break;
        }
      }

      if (!dismissed) {
        usable.push({
          ...candidate,
          requests: candidate.requests.map(
            request => requests.find(item => item.id === request.id) || request
          )
        });
      }
    }

    const assigned = pickAssignments(usable);
    const notifiedKeys = new Set();

    for (const candidate of assigned.values()) {
      const key = candidate.userIds.join(",");

      if (notifiedKeys.has(key)) {
        continue;
      }

      notifiedKeys.add(key);
      await notifyCandidate(guild.client, eventConfig, candidate);
    }

    return usable;
  });
}

async function recordInterest(guild, eventConfig, matchId, ownerUserId) {
  const match = await getLfgMatch(matchId);

  if (!match || match.status === "dead") {
    return { ok: false, message: "That match is no longer available." };
  }

  if (match.dismissedOwnerIds.includes(ownerUserId)) {
    return { ok: false, message: "You already passed on this match." };
  }

  const interested = [...new Set([...match.interestedOwnerIds, ownerUserId])];
  const liveRequests = [];

  for (const requestId of match.requestIds) {
    const request = await getLfgRequest(requestId);

    if (request?.active) {
      liveRequests.push(request);
    }
  }

  if (liveRequests.length < 2) {
    await updateLfgMatch(matchId, {
      interestedOwnerIds: interested,
      status: "dead"
    });
    return { ok: false, message: "The other players are no longer looking." };
  }

  const requiredOwners = liveRequests.map(request => request.ownerUserId);
  const allInterested = requiredOwners.every(id => interested.includes(id));

  await updateLfgMatch(matchId, {
    interestedOwnerIds: interested,
    status: allInterested ? "matched" : "proposed"
  });

  const others = requiredOwners.filter(id => id !== ownerUserId);

  if (allInterested) {
    for (const userId of requiredOwners) {
      await sendDm(guild.client, userId, {
        content: confirmedMatchContent(eventConfig.eventName, match.userIds),
        allowedMentions: { users: match.userIds }
      });
    }

    return { ok: true, matched: true };
  }

  for (const userId of others) {
    await sendDm(guild.client, userId, {
      content: interestedNotifyContent(ownerUserId, eventConfig.eventName),
      allowedMentions: { users: [ownerUserId] }
    });
  }

  return { ok: true, matched: false };
}

async function dismissMatch(guild, eventConfig, matchId, ownerUserId) {
  const match = await getLfgMatch(matchId);

  if (!match) {
    return { ok: false, message: "That match is no longer available." };
  }

  const dismissed = [...new Set([...match.dismissedOwnerIds, ownerUserId])];

  await updateLfgMatch(matchId, {
    dismissedOwnerIds: dismissed,
    status: "dead"
  });

  for (const requestId of match.requestIds) {
    lastNotifyAt.delete(requestId);
  }

  if (eventConfig) {
    await recalculateMatches(guild, eventConfig);
  }

  return { ok: true };
}

async function stopLooking(client, request, eventName) {
  if (!request?.active) {
    return request;
  }

  const closed = await closeLfgRequest(request.id, "stop_looking");
  await sendDm(client, request.ownerUserId, {
    content: stoppedLookingContent(eventName || "this event")
  });

  return closed;
}

async function probeDm(client, userId, content) {
  return sendDm(client, userId, { content });
}

async function countMatchStats(guild, eventConfig) {
  const candidates = await findMatchCandidates(guild, eventConfig);
  const active = await listActiveRequests(eventConfig.discordEventId);
  const complete = candidates.filter(candidate => candidate.complete);
  const unmatched = active.filter(
    request =>
      !complete.some(candidate => candidate.requestIds.includes(request.id))
  );
  const partialTeams = active.filter(
    request => request.memberUserIds.length > 1
  );

  return {
    activeCount: active.length,
    completeMatchCount: complete.length,
    unmatchedCount: unmatched.length,
    partialTeamCount: partialTeams.length
  };
}

module.exports = {
  findMatchCandidates,
  recalculateMatches,
  recordInterest,
  dismissMatch,
  stopLooking,
  probeDm,
  countMatchStats
};
