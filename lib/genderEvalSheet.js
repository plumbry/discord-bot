const { getSheets } = require("./sheets");

const SHEET_TAB = process.env.GENDER_SHEET_NAME || "Gender Sheet";
const DATA_RANGE = `${SHEET_TAB}!A:E`;

const FEMALE_GENDER_VALUE = Number(
  process.env.FEMALE_EVALUATED_GENDER_VALUE || 50
);

/** @type {Map<string, { tag: string, gender: number, status: string }>} */
let genderEvalCache = new Map();
let genderEvalCacheReady = false;

function getSpreadsheetId() {
  return (
    process.env.GENDER_SHEET_ID ||
    process.env.GIRL_ROLE_SHEET_ID ||
    process.env.MAIN_SHEET_ID ||
    "1K5BcAIM-Of9buZVmBzdtGRvjJO2XP9ZAPbFIzE5j1ZM"
  );
}

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 && getSpreadsheetId()
  );
}

function cleanDiscordId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      return null;
    }

    return String(value);
  }

  const digits = String(value)
    .normalize("NFKC")
    .replace(/^'/, "")
    .replace(/[^\d]/g, "")
    .trim();

  return digits.length >= 17 && digits.length <= 20 ? digits : null;
}

function parseGenderValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number.parseInt(String(value ?? "").trim(), 10);

  return Number.isFinite(parsed) ? parsed : null;
}

async function loadGenderEvalCache() {
  if (!isConfigured()) {
    console.warn(
      "[GENDER SHEET] Skipping cache load — Google Sheets not configured"
    );
    return;
  }

  try {
    const res = await getSheets().spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: DATA_RANGE,
      valueRenderOption: "UNFORMATTED_VALUE"
    });

    const rows = res.data.values || [];
    const next = new Map();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      if (!row) {
        continue;
      }

      const id = cleanDiscordId(row[0]);
      const gender = parseGenderValue(row[2]);
      const status = String(row[3] || "").trim().toLowerCase();

      if (!id || gender === null) {
        continue;
      }

      if (
        status !== "active" &&
        status !== "former" &&
        status !== "application"
      ) {
        continue;
      }

      next.set(id, {
        tag: String(row[1] || "").trim(),
        gender,
        status
      });
    }

    genderEvalCache = next;
    genderEvalCacheReady = true;

    const femaleCount = [...next.values()].filter(
      entry => entry.gender === FEMALE_GENDER_VALUE
    ).length;

    console.log(
      `[GENDER SHEET] Cache loaded: ${next.size} row(s), ${femaleCount} with gender ${FEMALE_GENDER_VALUE}`
    );
  } catch (err) {
    genderEvalCacheReady = false;
    console.error("[GENDER SHEET] Failed to load cache:", err?.message || err);
  }
}

async function ensureGenderEvalCacheReady() {
  if (!genderEvalCacheReady && isConfigured()) {
    await loadGenderEvalCache();
  }
}

async function isFemaleEvaluatedOnSheet(discordId) {
  if (!isConfigured()) {
    return false;
  }

  const id = cleanDiscordId(discordId);

  if (!id) {
    return false;
  }

  await ensureGenderEvalCacheReady();

  const entry = genderEvalCache.get(id);

  return entry?.gender === FEMALE_GENDER_VALUE;
}

async function listFemaleEvaluatedMembersFromSheet() {
  await ensureGenderEvalCacheReady();

  const members = [];

  for (const [discordUserId, entry] of genderEvalCache.entries()) {
    if (entry.gender !== FEMALE_GENDER_VALUE) {
      continue;
    }

    members.push({
      discordUserId,
      discordUsername: entry.tag
    });
  }

  return members;
}

function getReconcileIntervalMs() {
  const raw = process.env.GENDER_SHEET_RECONCILE_INTERVAL_MS;

  if (raw === "0" || raw === "false") {
    return 0;
  }

  const parsed = Number.parseInt(raw || "", 10);

  if (!Number.isFinite(parsed) || parsed < 60_000) {
    return 30 * 60 * 1000;
  }

  return parsed;
}

function startGenderEvalReconciler(client, guildId, reconcilePendingRoles) {
  const intervalMs = getReconcileIntervalMs();

  if (intervalMs <= 0 || !isConfigured() || !reconcilePendingRoles) {
    return;
  }

  const tick = async () => {
    try {
      const guild = await client.guilds.fetch(guildId).catch(() => null);

      if (!guild) {
        return;
      }

      await loadGenderEvalCache();
      await reconcilePendingRoles(guild);
    } catch (err) {
      console.error("[GENDER SHEET] reconcile failed:", err?.message || err);
    }
  };

  setInterval(tick, intervalMs);
  console.log(
    `[GENDER SHEET] Scheduled reconcile every ${Math.round(intervalMs / 60_000)} min`
  );
}

module.exports = {
  FEMALE_GENDER_VALUE,
  isConfigured,
  loadGenderEvalCache,
  ensureGenderEvalCacheReady,
  isFemaleEvaluatedOnSheet,
  listFemaleEvaluatedMembersFromSheet,
  startGenderEvalReconciler
};
