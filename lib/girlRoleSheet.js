const { getSheets } = require("./sheets");

const GIRL_ROLE_ID =
  process.env.GIRL_ROLE_ID || "1371652325629755472";

const SHEET_TAB = process.env.GIRL_ROLE_SHEET_NAME || "Girl Role";
const APPEND_RANGE = `${SHEET_TAB}!A:B`;
const ID_RANGE = `${SHEET_TAB}!A:A`;

let girlCache = new Set();
let girlCacheReady = false;

function getSpreadsheetId() {
  return (
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

/** Normalise Discord IDs from sheet cells (unicode, stray chars). */
function cleanId(value) {
  if (!value) {
    return null;
  }

  const digits = String(value)
    .normalize("NFKC")
    .replace(/[^\d]/g, "")
    .trim();

  return digits.length >= 17 ? digits : null;
}

async function loadGirlCache() {
  if (!isConfigured()) {
    console.warn("[GIRL ROLE] Skipping cache load — Google Sheets not configured");
    return;
  }

  try {
    const res = await getSheets().spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: ID_RANGE
    });

    girlCache = new Set(
      (res.data.values || [])
        .map(row => cleanId(row[0]))
        .filter(Boolean)
    );

    girlCacheReady = true;
    console.log(`[GIRL ROLE] Cache loaded: ${girlCache.size} ID(s)`);
  } catch (err) {
    girlCacheReady = false;
    console.error("[GIRL ROLE] Failed to load cache:", err?.message || err);
  }
}

async function addGirlVerified(user) {
  if (!isConfigured() || !user?.id) {
    return { added: false, reason: "not_configured" };
  }

  const id = cleanId(user.id);

  if (!id) {
    return { added: false, reason: "invalid_id" };
  }

  if (girlCache.has(id)) {
    return { added: false, reason: "already_cached" };
  }

  try {
    await getSheets().spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: APPEND_RANGE,
      valueInputOption: "RAW",
      requestBody: {
        values: [[id, user.tag || user.username || ""]]
      }
    });

    girlCache.add(id);
    console.log(`[GIRL ROLE] Added to sheet: ${user.tag || id}`);
    return { added: true };
  } catch (err) {
    console.error("[GIRL ROLE] Sheet append failed:", err?.message || err);
    return { added: false, reason: "sheet_error" };
  }
}

async function reapplyGirlRoleOnJoin(member) {
  if (!member || member.user?.bot) {
    return;
  }

  const id = cleanId(member.id);

  if (!id) {
    return;
  }

  if (!girlCacheReady) {
    await loadGirlCache();
  }

  if (!girlCache.has(id)) {
    return;
  }

  const role = member.guild.roles.cache.get(GIRL_ROLE_ID);

  if (!role) {
    console.warn("[GIRL ROLE] Role not found in guild:", GIRL_ROLE_ID);
    return;
  }

  if (member.roles.cache.has(GIRL_ROLE_ID)) {
    return;
  }

  try {
    await member.roles.add(role);
    console.log(`[GIRL ROLE] Reapplied on join: ${member.user.tag}`);
  } catch (err) {
    console.error(
      `[GIRL ROLE] Reapply failed for ${member.user.tag}:`,
      err?.message || err
    );
  }
}

async function handleGirlRoleGained(oldMember, newMember) {
  if (!newMember || newMember.user?.bot) {
    return;
  }

  const hadRole = oldMember?.roles?.cache?.has(GIRL_ROLE_ID);
  const hasRole = newMember.roles.cache.has(GIRL_ROLE_ID);

  if (!hadRole && hasRole) {
    await addGirlVerified(newMember.user);
  }
}

/**
 * Discord → sheet: ensure every member with the Girl role is listed on the sheet.
 */
async function backfillGirlRolesFromDiscord(guild) {
  if (!guild || !isConfigured()) {
    return { scanned: 0, added: 0, skipped: true };
  }

  if (!girlCacheReady) {
    await loadGirlCache();
  }

  await guild.members.fetch();

  let scanned = 0;
  let added = 0;

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) {
      continue;
    }

    if (!member.roles.cache.has(GIRL_ROLE_ID)) {
      continue;
    }

    scanned += 1;
    const result = await addGirlVerified(member.user);

    if (result.added) {
      added += 1;
    }
  }

  console.log(
    `[GIRL ROLE] Backfill done: ${added} added, ${scanned} with role on Discord`
  );

  return { scanned, added, skipped: false };
}

function shouldBackfillOnStartup() {
  const raw = String(process.env.GIRL_ROLE_BACKFILL_ON_STARTUP ?? "true")
    .trim()
    .toLowerCase();

  return raw !== "false" && raw !== "0" && raw !== "no";
}

module.exports = {
  GIRL_ROLE_ID,
  isConfigured,
  loadGirlCache,
  addGirlVerified,
  reapplyGirlRoleOnJoin,
  handleGirlRoleGained,
  backfillGirlRolesFromDiscord,
  shouldBackfillOnStartup
};
