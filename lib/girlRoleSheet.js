const { getSheets } = require("./sheets");
const { GIRL_ROLE_ID, memberHasGirlRole } = require("./memberProfile");

const SHEET_TAB = process.env.GIRL_ROLE_SHEET_NAME || "Girl Role";
const DATA_RANGE = `${SHEET_TAB}!A:B`;

/** @type {Map<string, { tag: string, row: number }>} */
let girlCache = new Map();
let girlCacheReady = false;

const APPEND_DELAY_MS = Number(process.env.GIRL_ROLE_APPEND_DELAY_MS || 250);

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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Normalise Discord user IDs from Discord objects or sheet cells. */
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

/** Store IDs as text so Sheets does not round snowflakes. */
function sheetIdCell(id) {
  return `'${id}`;
}

async function loadGirlCache() {
  if (!isConfigured()) {
    console.warn("[GIRL ROLE] Skipping cache load — Google Sheets not configured");
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

    for (let i = 0; i < rows.length; i++) {
      const id = cleanDiscordId(rows[i][0]);

      if (!id) {
        continue;
      }

      next.set(id, {
        tag: String(rows[i][1] || "").trim(),
        row: i + 1
      });
    }

    girlCache = next;
    girlCacheReady = true;
    console.log(`[GIRL ROLE] Cache loaded: ${girlCache.size} ID(s) from sheet`);
  } catch (err) {
    girlCacheReady = false;
    console.error("[GIRL ROLE] Failed to load cache:", err?.message || err);
  }
}

async function addGirlVerified(user) {
  if (!isConfigured() || !user?.id) {
    return { added: false, reason: "not_configured" };
  }

  const id = cleanDiscordId(user.id);

  if (!id) {
    return { added: false, reason: "invalid_id" };
  }

  if (girlCache.has(id)) {
    return { added: false, reason: "already_cached" };
  }

  const tag = user.tag || user.username || "";

  try {
    await getSheets().spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: DATA_RANGE,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[sheetIdCell(id), tag]]
      }
    });

    girlCache.set(id, { tag, row: null });
    console.log(`[GIRL ROLE] Added to sheet: ${tag || id}`);
    return { added: true };
  } catch (err) {
    console.error("[GIRL ROLE] Sheet append failed:", err?.message || err);
    return { added: false, reason: "sheet_error" };
  }
}

async function batchUpdateGirlTags(updates) {
  if (!updates.length) {
    return 0;
  }

  const sheets = getSheets();
  const data = [];

  for (const { id, tag, row } of updates) {
    data.push({
      range: `${SHEET_TAB}!A${row}:B${row}`,
      values: [[sheetIdCell(id), tag]]
    });
  }

  const chunkSize = 100;

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: chunk
      }
    });

    for (const entry of chunk) {
      const row = Number(entry.range.match(/A(\d+)/)?.[1]);

      if (!row) {
        continue;
      }

      const id = cleanDiscordId(entry.values[0][0]);
      const tag = entry.values[0][1];

      if (id) {
        girlCache.set(id, { tag, row });
      }
    }
  }

  return updates.length;
}

async function updateGirlRow(id, tag, rowNumber) {
  if (!rowNumber || rowNumber < 1) {
    return false;
  }

  try {
    await getSheets().spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `${SHEET_TAB}!A${rowNumber}:B${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[sheetIdCell(id), tag]]
      }
    });

    girlCache.set(id, { tag, row: rowNumber });
    return true;
  } catch (err) {
    console.error(
      `[GIRL ROLE] Row update failed for ${tag || id}:`,
      err?.message || err
    );
    return false;
  }
}

async function reapplyGirlRoleOnJoin(member) {
  if (!member || member.user?.bot) {
    return;
  }

  const id = cleanDiscordId(member.id);

  if (!id) {
    return;
  }

  if (!girlCacheReady) {
    await loadGirlCache();
  }

  if (!girlCache.has(id)) {
    return;
  }

  if (memberHasGirlRole(member)) {
    return;
  }

  const role = member.guild.roles.cache.get(GIRL_ROLE_ID);

  if (!role) {
    console.warn("[GIRL ROLE] Role not found in guild:", GIRL_ROLE_ID);
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

async function resolveMember(memberRef) {
  if (!memberRef) {
    return null;
  }

  if (memberRef.partial) {
    return memberRef.fetch().catch(() => memberRef);
  }

  return memberRef;
}

async function handleGirlRoleGained(oldMember, newMember) {
  if (!newMember || newMember.user?.bot) {
    return;
  }

  const oldResolved = await resolveMember(oldMember);
  const hadRole = memberHasGirlRole(oldResolved);
  const hasRole = memberHasGirlRole(newMember);

  if (!hadRole && hasRole) {
    await addGirlVerified(newMember.user);
  }
}

/**
 * Discord → sheet: everyone with a Girl role on Discord should have a sheet row.
 */
async function backfillGirlRolesFromDiscord(guild) {
  if (!guild || !isConfigured()) {
    return {
      scanned: 0,
      added: 0,
      tagsUpdated: 0,
      missingSamples: [],
      skipped: true
    };
  }

  if (!girlCacheReady) {
    await loadGirlCache();
  }

  await guild.members.fetch();

  let scanned = 0;
  let added = 0;
  let tagsUpdated = 0;
  const missingSamples = [];
  const tagUpdates = [];

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) {
      continue;
    }

    if (!memberHasGirlRole(member)) {
      continue;
    }

    scanned += 1;

    const id = cleanDiscordId(member.id);
    const tag = member.user.tag || member.user.username || "";
    const existing = girlCache.get(id);

    if (!existing) {
      const result = await addGirlVerified(member.user);

      if (result.added) {
        added += 1;
      } else if (missingSamples.length < 15) {
        missingSamples.push(`${tag} (${result.reason || "failed"})`);
      }

      await delay(APPEND_DELAY_MS);
      continue;
    }

    const sheetTag = existing.tag.toLowerCase();
    const liveTag = tag.toLowerCase();

    if (sheetTag !== liveTag && existing.row) {
      tagUpdates.push({ id, tag, row: existing.row });
    }
  }

  if (tagUpdates.length) {
    tagsUpdated = await batchUpdateGirlTags(tagUpdates);
  }

  console.log(
    `[GIRL ROLE] Backfill done: ${added} added, ${tagsUpdated} tag(s) updated, ` +
      `${scanned} with Girl role on Discord, ${girlCache.size} ID(s) on sheet`
  );

  return { scanned, added, tagsUpdated, missingSamples, skipped: false };
}

function shouldBackfillOnStartup() {
  const raw = String(process.env.GIRL_ROLE_BACKFILL_ON_STARTUP ?? "true")
    .trim()
    .toLowerCase();

  return raw !== "false" && raw !== "0" && raw !== "no";
}

function getReconcileIntervalMs() {
  const raw = process.env.GIRL_ROLE_RECONCILE_INTERVAL_MS;
  const parsed = Number.parseInt(raw || "", 10);

  if (!Number.isFinite(parsed) || parsed < 60_000) {
    return 4 * 60 * 60 * 1000;
  }

  return parsed;
}

function startGirlRoleReconciler(client, guildId) {
  const intervalMs = getReconcileIntervalMs();

  if (intervalMs <= 0 || !isConfigured()) {
    return;
  }

  const tick = async () => {
    try {
      const guild = await client.guilds.fetch(guildId).catch(() => null);

      if (!guild) {
        return;
      }

      await loadGirlCache();
      await backfillGirlRolesFromDiscord(guild);
    } catch (err) {
      console.error("[GIRL ROLE] reconcile failed:", err?.message || err);
    }
  };

  setInterval(tick, intervalMs);
  console.log(
    `[GIRL ROLE] Scheduled reconcile every ${Math.round(intervalMs / 60_000)} min`
  );
}

module.exports = {
  GIRL_ROLE_ID,
  isConfigured,
  loadGirlCache,
  addGirlVerified,
  reapplyGirlRoleOnJoin,
  handleGirlRoleGained,
  backfillGirlRolesFromDiscord,
  shouldBackfillOnStartup,
  startGirlRoleReconciler
};
