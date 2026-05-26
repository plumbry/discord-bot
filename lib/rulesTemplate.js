const { TIER_RESTRICTIONS_URL } = require("./tierRestrictions");
const { DEFAULT_RULES_MODULE_CONTENT } = require("./rulesModuleDefaults");

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

const CREATE_TICKET_URL =
  "https://discord.com/channels/1371615693392576580/1371651766407532654";

function applyTemplateVars(text, vars) {
  let out = String(text ?? "");

  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(String(value ?? ""));
  }

  return out;
}

function buildTemplateVars({
  mode,
  tierRestrictionsUrl,
  streamTitle,
  firstPenalty,
  secondPenalty,
  thirdPenaltyText,
  killCap,
  separateDropmaps,
  dropmapExtraLine
}) {
  const cap = Number(killCap);
  const streamPlayersPerTeam = mode === "squad" ? 2 : 1;

  return {
    killCap: Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : "",
    modeFormat: formatModeLabel(mode),
    modeLabel: titleCaseMode(mode),
    modeLabelUpper: titleCaseMode(mode).toUpperCase(),
    tierUrl: tierRestrictionsUrl || TIER_RESTRICTIONS_URL,
    streamTitle: streamTitle?.trim() || "_Stream title not set_",
    streamPlayers: streamPlayersPerTeam,
    streamPlayersPlural: streamPlayersPerTeam > 1 ? "S" : "",
    firstPenalty,
    secondPenalty,
    thirdPenalty: thirdPenaltyText,
    separateDropmapsLine: separateDropmaps
      ? "- Girls and guys have separate dropmap"
      : "",
    dropmapExtraLine: dropmapExtraLine?.trim()
      ? `- ${dropmapExtraLine.trim()}`
      : ""
  };
}

function resolveModuleLines(modules, moduleKey, vars) {
  const content =
    modules?.[moduleKey] ?? DEFAULT_RULES_MODULE_CONTENT[moduleKey] ?? "";

  if (!content.trim()) {
    return [];
  }

  return content
    .split("\n")
    .map(line => applyTemplateVars(line, vars).trimEnd())
    .filter(line => line.length > 0);
}

function buildRulesMessage({
  eventName,
  eventDateTime,
  mode,
  tierRestrictionsUrl = DEFAULT_TIER_RESTRICTIONS_URL,
  streamTitle,
  perGameRules = [],
  dropmapEnabled = true,
  separateDropmaps = false,
  dropmapExtraLine = "",
  firstPenalty = 20,
  secondPenalty = 40,
  thirdPenaltyText = "Disqualification",
  killCap = null,
  gameLabel = "",
  sheetModules = null
}) {
  const modules = sheetModules || {};
  const vars = buildTemplateVars({
    mode,
    tierRestrictionsUrl,
    streamTitle,
    firstPenalty,
    secondPenalty,
    thirdPenaltyText,
    killCap,
    separateDropmaps,
    dropmapExtraLine
  });

  const gameLine = gameLabel?.trim()
    ? `🎮 **Game:** ${gameLabel.trim()}`
    : null;

  const lines = [
    `# ${eventName}`,
    "",
    `🗓️ **When** ${eventDateTime}`,
    `👥 **Format:** ZB COED ${formatModeLabel(mode)}`,
    ...(gameLine ? ["", gameLine] : [])
  ];

  if (vars.killCap) {
    lines.push(...resolveModuleLines(modules, "kill_cap", vars));
  }

  lines.push("", ...resolveModuleLines(modules, "game_rules", vars), "");

  const tierKey =
    mode === "solo" ? "tier_restrictions_solo" : "tier_restrictions_team";

  lines.push(...resolveModuleLines(modules, tierKey, vars), "");

  lines.push(...resolveModuleLines(modules, "streaming", vars), "");

  const dropmapKey = dropmapEnabled ? "dropmap_on" : "dropmap_off";

  lines.push(...resolveModuleLines(modules, dropmapKey, vars), "");

  lines.push(...resolveModuleLines(modules, "penalties", vars));

  if (perGameRules.length) {
    const title =
      resolveModuleLines(modules, "special_game_rules_title", vars)[0] ||
      DEFAULT_RULES_MODULE_CONTENT.special_game_rules_title;

    lines.push("", title, ...perGameRules.map(rule => `- ${rule}`));
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
    "-# Staff can update this list with /bans or /rules without reposting."
  ];

  return lines.join("\n");
}

module.exports = {
  DEFAULT_TIER_RESTRICTIONS_URL,
  DEFAULT_BANS,
  MODE_LABELS,
  CREATE_TICKET_URL,
  titleCaseMode,
  normalizeBans,
  isDefaultBan,
  extraBansOnly,
  formatListInput,
  applyTemplateVars,
  buildRulesMessage,
  buildBansMessage
};
