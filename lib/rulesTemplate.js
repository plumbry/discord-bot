const { TIER_RESTRICTIONS_URL } = require("./tierRestrictions");

const DEFAULT_TIER_RESTRICTIONS_URL = TIER_RESTRICTIONS_URL;
const DEFAULT_BANS = [
  "Any weapon that uses SNIPER or EXPLOSIVE ammo"
];

const MODE_LABELS = {
  solo: "Solo",
  duo: "Duo",
  trio: "Trio",
  squad: "Squad"
};

const MODE_FORMAT_LABELS = {
  solo: "SOLO",
  duo: "DUOS",
  trio: "TRIOS",
  squad: "SQUADS"
};

function formatModeLabel(mode) {
  return MODE_FORMAT_LABELS[mode] || titleCaseMode(mode).toUpperCase();
}

function titleCaseMode(mode) {
  return MODE_LABELS[mode] || mode;
}

function normalizeBans(bans) {
  const seen = new Set();
  const out = [];

  for (const raw of [...DEFAULT_BANS, ...(Array.isArray(bans) ? bans : [])]) {
    const item = raw?.trim();

    if (!item) {
      continue;
    }

    const lower = item.toLowerCase();

    if (seen.has(lower)) {
      continue;
    }

    seen.add(lower);
    out.push(item);
  }

  return out;
}

function isDefaultBan(item) {
  const target = item?.trim().toLowerCase();
  return DEFAULT_BANS.some(ban => ban.toLowerCase() === target);
}

function extraBansOnly(bans) {
  return normalizeBans(bans).filter(item => !isDefaultBan(item));
}

function formatListInput(items) {
  return (Array.isArray(items) ? items : []).join("\n");
}

function buildTierRestrictionsSection(mode, tierRestrictionsUrl) {
  const url = tierRestrictionsUrl || TIER_RESTRICTIONS_URL;

  if (mode === "solo") {
    return [
      "## TIER RESTRICTIONS",
      `-# Want to check Tier Restrictions? [Click Here](${url})`
    ];
  }

  return [
    `## TIER RESTRICTIONS FOR ${formatModeLabel(mode)}`,
    `-# Want to check Tier Restrictions? [Click Here](${url})`
  ];
}

function buildRulesMessage({
  eventName,
  eventDateTime,
  mode,
  eventType = "standard",
  tierRestrictionsUrl = DEFAULT_TIER_RESTRICTIONS_URL,
  streamTitle,
  perGameRules = [],
  dropmapEnabled = true,
  separateDropmaps = false,
  dropmapExtraLine = "",
  firstPenalty = 20,
  secondPenalty = 40,
  thirdPenaltyText = "Disqualification"
}) {
  const streamPlayersPerTeam = mode === "squad" ? 2 : 1;
  const lines = [
    `# ${eventName}`,
    "",
    `🗓️ **When** ${eventDateTime}`,
    `👥 **Format:** ZB COED ${formatModeLabel(mode)}`,
    "",
    ...buildTierRestrictionsSection(mode, tierRestrictionsUrl),
    "",
    "## :ZBDCROWN: GAME RULES :ZBDCROWN:",
    "- Anonymous Mode MUST be turned OFF",
    "- Any form of negativity or toxicity towards ANY player, admin or host will NOT be tolerated and will have consequences",
    "- No teaming",
    "- No cheating",
    "- No Stream Sniping",
    "- Skipping an event to play another tournament at the same time will result in an event ban",
    "- Only restarting the game if 2+ **FULL** teams didn't get in the Battle Bus",
    "- If the same team bricks **twice** in a single event, we will restart the game",
    "",
    "## 🖥️ STREAMING 🖥️",
    `${streamPlayersPerTeam} PLAYER${streamPlayersPerTeam > 1 ? "S" : ""} PER ${titleCaseMode(mode).toUpperCase()} MUST STREAM on twitch`,
    `- Stream Title: ${streamTitle || eventName}`,
    "- VODs need to stay up for at least 24 hrs after each event",
    "- Full in-game audio must be hearable, including all teammates' comms",
    "🎥 All stream links must be posted in the channel before each event start!",
    "-# If you are streaming from console, use gamechat for comms to be audible",
    "",
    "## 🗺️ DROP MAP 🗺️",
    ...(dropmapEnabled
      ? [
          "- MANDATORY",
          "- Each PERSON mark on the map",
          ...(separateDropmaps
            ? ["- Girls and guys have separate dropmap"]
            : []),
          "📍 If you don't mark your dropspot in time, an admin will choose one for you",
          "- You cannot modify or extend the premade box",
          "- NO QUAD CONNING",
          "-# You must land in your team's marked box. Landing and looting outside of your box offspawn is considered a rule break.",
          ...(dropmapExtraLine?.trim()
            ? [`- ${dropmapExtraLine.trim()}`]
            : [])
        ]
      : ["- No dropmap for this event."]),
    "",
    "**:ZBDMOD: PENALTIES FOR RULE BREAKS & USE OF BANNED ITEMS :ZBDHAMMER:**",
    "- *No warnings!*",
    `- **1st offense**: -${firstPenalty} points`,
    `- **2nd offense**: -${secondPenalty} points`,
    `- **3rd offense**: ${thirdPenaltyText}`,
    "- If you believe someone has broken any rules please #create-ticket and let us know with PROOF",
    "",
    "### Additional Event Rules",
    "- Follow host instructions and Discord server rules.",
    "- No teaming or collusion outside your squad.",
    "- No exploit abuse, glitches, or unfair advantages.",
    "- Keep comms and chat respectful at all times.",
    `- Event type: ${eventType === "special" ? "Special" : "Standard"}`
  ];

  if (perGameRules.length) {
    lines.push(
      "",
      "### Per-Game Rules",
      ...perGameRules.map(rule => `- ${rule}`)
    );
  }

  return lines.join("\n");
}

function buildBansMessage({ bans }) {
  const effectiveBans = normalizeBans(bans);

  const lines = [
    "## 🚫  BANNED ITEMS  🚫",
    "",
    effectiveBans.map(item => `- ${item}`).join("\n"),
    "",
    "-# Staff can update this list using /rules commands without reposting rules."
  ];

  return lines.join("\n");
}

module.exports = {
  DEFAULT_TIER_RESTRICTIONS_URL,
  DEFAULT_BANS,
  MODE_LABELS,
  titleCaseMode,
  normalizeBans,
  isDefaultBan,
  extraBansOnly,
  formatListInput,
  buildRulesMessage,
  buildBansMessage
};
