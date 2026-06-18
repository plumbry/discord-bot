const { PermissionFlagsBits } = require("discord.js");
const {
  DEFAULT_DASHBOARD_CHANNEL_ID
} = require("./scrimDashboardSheet");
const {
  isSignupChannelName,
  isDropmapChannelName
} = require("../commands/dropmapcheck");

const ACTIONS = [
  {
    key: "gamecall",
    label: "Game Call",
    patterns: ["gamecall", "game-call", "game-codes", "manual"],
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AddReactions
    ]
  },
  {
    key: "vod",
    label: "VOD Check",
    patterns: ["twitch-links", "stream-links"],
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory
    ]
  },
  {
    key: "checklive",
    label: "Live Check",
    patterns: ["twitch-links", "stream-links"],
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory
    ]
  },
  {
    key: "teamstreamcheck",
    label: "Twitch Links",
    patterns: ["twitch-links", "stream-links"],
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory
    ]
  },
  {
    key: "voicecheck",
    label: "Voice Check",
    useDashboardChannel: true,
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages
    ]
  },
  {
    key: "unreg",
    label: "Unregister Team",
    matcher: isSignupChannel,
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages
    ]
  },
  {
    key: "dropmapcheck",
    label: "Dropmap Check",
    matcher: isDropmapChannel,
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory
    ]
  },
  {
    key: "dropmapclosed",
    label: "Dropmap Closed",
    matcher: isDropmapChannel,
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages
    ]
  }
];

function isSignupChannel(channel) {
  const name = channel.name?.toLowerCase?.() || "";

  return (
    isSignupChannelName(name) &&
    !name.includes("solo") &&
    !name.includes("lfg") &&
    !name.includes("free-agent")
  );
}

function isDropmapChannel(channel) {
  return isDropmapChannelName(channel.name || "");
}

function isTextChannelInCategory(channel, categoryId) {
  return (
    channel?.parentId === categoryId &&
    channel.isTextBased?.() &&
    !channel.isThread?.()
  );
}

function channelMatchesPatterns(channel, patterns) {
  const normalized = (channel.name || "").toLowerCase();
  return patterns.some(pattern => normalized.includes(pattern));
}

function getMissingPermissions(channel, permissions) {
  const me = channel.guild?.members?.me;
  const perms = me ? channel.permissionsFor(me) : null;

  if (!perms) {
    return ["Unknown permissions"];
  }

  return permissions
    .filter(permission => !perms.has(permission))
    .map(permission => permission.toString());
}

function formatPermissionWarning(missing) {
  if (!missing.length) {
    return null;
  }

  return `Bot missing required permission(s): ${missing.join(", ")}`;
}

function findMatches(guild, categoryId, action) {
  return [...guild.channels.cache.values()]
    .filter(channel => isTextChannelInCategory(channel, categoryId))
    .filter(channel => {
      if (action.matcher) {
        return action.matcher(channel);
      }

      return channelMatchesPatterns(channel, action.patterns || []);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveActionChannel({
  guild,
  categoryId,
  dashboardChannel,
  action,
  overrides
}) {
  const overrideId = overrides?.[action.key] || "";

  if (overrideId) {
    const channel = guild.channels.cache.get(overrideId);

    if (!channel?.isTextBased?.()) {
      return {
        key: action.key,
        label: action.label,
        status: "missing",
        channelId: "",
        matches: [],
        warning: "Configured override channel was not found."
      };
    }

    const missing = getMissingPermissions(channel, action.permissions);

    return {
      key: action.key,
      label: action.label,
      status: "overridden",
      channelId: channel.id,
      matches: [channel.id],
      warning: formatPermissionWarning(missing)
    };
  }

  if (action.useDashboardChannel) {
    const channel = dashboardChannel || guild.channels.cache.get(
      DEFAULT_DASHBOARD_CHANNEL_ID
    );

    if (!channel?.isTextBased?.()) {
      return {
        key: action.key,
        label: action.label,
        status: "missing",
        channelId: "",
        matches: [],
        warning: "Dashboard channel was not found."
      };
    }

    const missing = getMissingPermissions(channel, action.permissions);

    return {
      key: action.key,
      label: action.label,
      status: "ready",
      channelId: channel.id,
      matches: [channel.id],
      warning: formatPermissionWarning(missing)
    };
  }

  const matches = findMatches(guild, categoryId, action);

  if (matches.length === 0) {
    return {
      key: action.key,
      label: action.label,
      status: "missing",
      channelId: "",
      matches: [],
      warning: null
    };
  }

  if (matches.length > 1) {
    return {
      key: action.key,
      label: action.label,
      status: "ambiguous",
      channelId: "",
      matches: matches.map(channel => channel.id),
      warning: "Multiple matching channels found. Set an override."
    };
  }

  const channel = matches[0];
  const missing = getMissingPermissions(channel, action.permissions);

  return {
    key: action.key,
    label: action.label,
    status: "ready",
    channelId: channel.id,
    matches: [channel.id],
    warning: formatPermissionWarning(missing)
  };
}

function resolveDashboardChannels({
  guild,
  categoryId,
  dashboardChannel,
  overrides = {}
}) {
  const results = {};

  if (!guild || !categoryId) {
    for (const action of ACTIONS) {
      results[action.key] = {
        key: action.key,
        label: action.label,
        status: "missing",
        channelId: "",
        matches: [],
        warning: "Active category is not set."
      };
    }

    return results;
  }

  for (const action of ACTIONS) {
    results[action.key] = resolveActionChannel({
      guild,
      categoryId,
      dashboardChannel,
      action,
      overrides
    });
  }

  return results;
}

function resolvedChannelIds(results) {
  const ids = {};

  for (const [key, result] of Object.entries(results || {})) {
    ids[key] = result.channelId || "";
  }

  return ids;
}

function isActionReady(results, key) {
  const result = results?.[key];
  return Boolean(
    result?.channelId &&
    (result.status === "ready" || result.status === "overridden") &&
    !result.warning
  );
}

module.exports = {
  ACTIONS,
  resolveDashboardChannels,
  resolvedChannelIds,
  isActionReady
};
