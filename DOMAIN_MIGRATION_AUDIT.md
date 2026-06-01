# Domain Migration Audit — Bot ↔ Website Communication

**Audit date:** 2026-05-31  
**Scope:** All URLs, API bases, webhooks, and user-facing links in the `discord-bot` repository that connect the Discord bot to the Hercules / ZBD website stack or expose website paths to Discord users.  
**Target domains under evaluation:** `coedzbd.com`, `app.coedzbd.com`, other subdomains.  
**Code changes:** None in this pass (documentation only).

---

## Executive summary

| Category | Count | Migration needed? |
|----------|------:|-------------------|
| Hercules / `onhercules.app` user-facing links | 2 source files (+ 4 consumers) | **Yes** → `app.coedzbd.com` |
| Convex HTTP API (`*.convex.site`) | 2 hardcoded defaults, 8 route suffixes | **Yes** (env + defaults) |
| Bot inbound webhooks (`welcome-ping.fly.dev`) | 0 in runtime code; 2 in ops config/docs | **Configure** on callers (Convex, Apps Script) |
| Discord deep links (verify / ticket / FAQ) | 3 files | **No** (Discord-native) |
| Third-party APIs (Yunite, Twitch, Google) | 4 files | **No** |
| Link buttons / embed `.setURL()` | 0 | **No** |
| OAuth redirect URLs (website) | 0 | **No** (not in this repo) |
| Bot-generated Discord invite links | 0 | **No** |

There are **no** occurrences of bare `hercules.app` (without `onhercules`) in application code.

---

## 1. Hercules website URLs (`onhercules.app`)

### 1.1 Tier restrictions page

| # | File | Line(s) | Current URL | Purpose | Target domain | Hardcoded / env |
|---|------|---------|-------------|---------|---------------|-----------------|
| 1 | `lib/tierRestrictions.js` | 1–2 | `https://coedzbd.onhercules.app/tier-restrictions` | Canonical tier-restrictions URL; used in LFG/tier validation rejection messages | **`app.coedzbd.com`** (`/tier-restrictions`) | **Hardcoded** constant `TIER_RESTRICTIONS_URL` |
| 2 | `commands/scrimremind.js` | 270 | `https://coedzbd.onhercules.app/tier-restrictions` | Markdown link in scheduled scrim reminder posts | **`app.coedzbd.com`** | **Hardcoded** (duplicate of #1; does not import `TIER_RESTRICTIONS_URL`) |

**Indirect consumers** (inherit URL from `lib/tierRestrictions.js` or template vars — no separate hardcoded domain):

| # | File | Purpose | Target domain | Hardcoded / env |
|---|------|---------|---------------|-----------------|
| 3 | `lib/rulesTemplate.js` | `DEFAULT_TIER_RESTRICTIONS_URL`, `{{tierUrl}}` in rules embeds/posts | **`app.coedzbd.com`** | Hardcoded via import |
| 4 | `lib/rulesModuleDefaults.js` | Default rules module text: `[Click Here]({{tierUrl}})` for solo/team tier sections | **`app.coedzbd.com`** | Template var (resolved from #1) |
| 5 | `commands/rules.js` | `/rules` command; `context.tierRestrictionsUrl` fallback | **`app.coedzbd.com`** | Hardcoded fallback via import |
| 6 | `commands/roletagged.js` | Tier combo rejection via `formatInvalidTierSignupMessage()` | **`app.coedzbd.com`** | Hardcoded via import |

**Runtime surfaces where users see this URL:**

- Scrim reminder channel messages (`scrimremind.js`)
- Event rules posts (`rules.js` → `buildRulesMessage`)
- LFG signup rejections (`roletagged.js`, tier validation in `tierRestrictions.js`)

**Google Sheets data (not in repo):** The **Rules Modules** tab (`lib/rulesModulesSheet.js`) can override module `Content`. If any row embeds `onhercules.app` literally instead of `{{tierUrl}}`, that text will bypass code defaults. Audit sheet rows at cutover.

---

## 2. Convex deployment / API base URLs

The bot has **no Convex SDK**. All website backend access is HTTP to `{baseUrl}/api/...` on a `*.convex.site` host (or whatever `CONVEX_API_BASE_URL` is set to).

### 2.1 Base URL defaults

| # | File | Line(s) | Current URL | Purpose | Target domain | Hardcoded / env |
|---|------|---------|-------------|---------|---------------|-----------------|
| 7 | `lib/discordApi.js` | 1–8 | `https://healthy-husky-184.convex.site` | Default base for member sync, ban role sync, ack endpoints | **New Convex deployment URL** or **`api.coedzbd.com`** if Convex custom domain is configured | **Env-driven** (`SCRIM_EVENTS_API_BASE_URL` → `CONVEX_API_BASE_URL` → hardcoded default) |
| 8 | `commands/spin.js` | 4–15 | `https://healthy-husky-184.convex.site` | Duplicate default for scrim spin wheel API | Same as #7 | **Env-driven** (same vars; duplicated helper, not shared import) |

**Environment variables:**

- `CONVEX_API_BASE_URL` — primary override
- `SCRIM_EVENTS_API_BASE_URL` — takes precedence when set (used by both #7 and #8)

**Auth (not URLs, but paired with API calls):**

- `DISCORD_SYNC_API_KEY` (fallback: `EVENT_BAN_WEBHOOK_SECRET`)
- `SCRIM_EVENTS_API_KEY` (fallback: `DISCORD_SYNC_API_KEY`) — spin command only

### 2.2 Outbound API routes (bot → Convex)

All paths are appended to `getApiBaseUrl()`. Full current URLs use base #7.

| # | File | Path | Method | Purpose | Target domain | Hardcoded / env |
|---|------|------|--------|---------|---------------|-----------------|
| 9 | `lib/memberSyncApi.js` | `/api/discord/sync-member` | POST | Push Discord member profile (id, username, nickname, roles, joined_at) to website on join/update/backfill | Same base as #7 | Path hardcoded; base env-driven |
| 10 | `lib/discordBanApi.js` | `/api/discord/pending-role-syncs` | GET | Poll pending event-ban / probation role assignments | Same base as #7 | Path hardcoded; base env-driven |
| 11 | `lib/discordBanApi.js` | `/api/discord/acknowledge-role-syncs` | POST | Ack processed role assignments | Same base as #7 | Path hardcoded; base env-driven |
| 12 | `lib/discordBanApi.js` | `/api/discord/pending-role-removals` | GET | Poll pending role removals | Same base as #7 | Path hardcoded; base env-driven |
| 13 | `lib/discordBanApi.js` | `/api/discord/acknowledge-role-removals` | POST | Ack processed removals | Same base as #7 | Path hardcoded; base env-driven |
| 14 | `commands/spin.js` | `/api/scrim-events/by-code/{eventCode}` | GET | Resolve scrim event by code for spin wheel | Same base as #8 | Path hardcoded; base env-driven |
| 15 | `commands/spin.js` | `/api/scrim-events/{eventId}/entries` | POST | Save spin-wheel team assignments to website | Same base as #8 | Path hardcoded; base env-driven |

**Callers / orchestration:**

- `bot.js` — member sync on `guildMemberAdd` / `guildMemberUpdate`, optional backfill interval
- `banExpiryChecker.js` — role sync poll loop (uses #10–#13)
- `lib/eventBanWebhook.js` — push path acks via same Convex routes after webhook apply
- `commands/syncmembers.js` — manual full sync (uses #9)
- `commands/spin.js` — scrim spin (uses #14–#15)

**Recommended target:** Set `CONVEX_API_BASE_URL` (and/or `SCRIM_EVENTS_API_BASE_URL`) to the production Convex HTTP URL. If the website team exposes Convex behind `api.coedzbd.com`, point env there; otherwise use the new `*.convex.site` deployment slug.

---

## 3. Webhook URLs (inbound to bot — website / ops → bot)

The bot **hosts** these paths on Fly.io app `welcome-ping` (see `fly.toml`). It does **not** hardcode its own public hostname in runtime JS; callers must know the full URL.

### 3.1 Bot HTTP routes (path only in code)

| # | File | Path | Method | Purpose | Public URL today (docs/ops) | Target domain | Hardcoded / env |
|---|------|------|--------|---------|------------------------------|---------------|-----------------|
| 16 | `lib/eventBanWebhook.js` | `/webhooks/role-sync` | POST | Push ban/probation role sync from Convex or sheet trigger | `https://welcome-ping.fly.dev/webhooks/role-sync` | **`welcome-ping.fly.dev`** or **`hooks.coedzbd.com`** (if custom domain added to Fly) | Path hardcoded; host is **Fly app name** (not env in bot) |
| 17 | `lib/eventBanWebhook.js` | `/webhooks/event-bans` | POST | Legacy empty-body webhook → fallback poll | `https://welcome-ping.fly.dev/webhooks/event-bans` | Same as #16 | Path hardcoded |
| 18 | `lib/tierClearApi.js` | `/api/tier-clear` | POST | Website-initiated tier role wipe in Discord | `https://welcome-ping.fly.dev/api/tier-clear` (implied) | Same as #16 | Path hardcoded |
| 19 | `lib/tierClearApi.js` | `/api/tier-clear/status` | GET | Tier-clear job status | `https://welcome-ping.fly.dev/api/tier-clear/status` | Same as #16 | Path hardcoded |
| 20 | `bot.js` | `/health`, `/` | GET | Fly health check | `https://welcome-ping.fly.dev/health` | Same as #16 | Path hardcoded |

**Auth:** `EVENT_BAN_WEBHOOK_SECRET` (#16–#17), `TIER_CLEAR_API_SECRET` or `EVENT_BAN_WEBHOOK_SECRET` (#18–#19).

### 3.2 External callers configured with full webhook URL

| # | File | Current URL | Purpose | Target domain | Hardcoded / env |
|---|------|-------------|---------|---------------|-----------------|
| 21 | `scripts/google-apps-script-event-bans-trigger.js` | `https://welcome-ping.fly.dev/webhooks/role-sync` (comment + Apps Script property `WEBHOOK_URL`) | Google Sheets `onSpreadsheetChange` → nudge bot role sync | Fly hostname or custom hooks subdomain | **Env-driven** in Apps Script properties (example URL hardcoded in comment) |
| 22 | `CONVEX_ROLE_SYNC_PUSH.md` | `https://welcome-ping.fly.dev/webhooks/role-sync` | Documentation for Convex backend team | Same as #21 | Documentation only |
| 23 | `DISCORD_SYNC_AUDIT.md` | `https://welcome-ping.fly.dev/webhooks/event-bans` | Documentation (legacy path) | Same as #21 | Documentation only |

**Convex backend (outside this repo):** Must POST role-sync webhooks to the bot's public URL (#16). Update Convex env/config when bot hostname changes.

---

## 4. Support / verification / ticket links

These point at **Discord channel permalinks**, not the website. No `coedzbd.com` migration required unless the Discord guild or channel IDs change.

| # | File | Current URL | Purpose | Target domain | Hardcoded / env |
|---|------|-------------|---------|---------------|-----------------|
| 24 | `welcome-ping/index.js` | `https://discord.com/channels/1371615693392576580/1371647079935377418` | Welcome DM: Yunite verify channel | **N/A (Discord)** | Hardcoded in `WELCOME_DM` |
| 25 | `welcome-ping/index.js` | `https://discord.com/channels/1371615693392576580/1371651766407532654` | Welcome DM: create-ticket channel | **N/A (Discord)** | Hardcoded |
| 26 | `welcome-ping/index.js` | `https://discord.com/channels/1371615693392576580/1436327300915531867` | Welcome DM: in-game setup / FAQ channel | **N/A (Discord)** | Hardcoded |
| 27 | `lib/rulesModuleDefaults.js` | `https://discord.com/channels/1371615693392576580/1371651766407532654` | Rules text: `#create-ticket` link for rule-break reports | **N/A (Discord)** | Hardcoded `CREATE_TICKET_URL` |
| 28 | `lib/rulesTemplate.js` | Same as #27 | Exported `CREATE_TICKET_URL` for rules templates | **N/A (Discord)** | Hardcoded (duplicate constant) |

**Note:** Verification is Discord-channel-based (Yunite verify + staff `/verify` command). There is **no** website OAuth or verification URL in this repo.

---

## 5. Event links

| # | File | URL type | Purpose | Target domain | Hardcoded / env |
|---|------|----------|---------|---------------|-----------------|
| 29 | `lib/scrimEventSheet.js` | `message.url` (Discord permalink) | Stored in sheet after scrim reminder send | **N/A (Discord)** | Runtime-generated |
| 30 | `commands/scrimremind.js` | `message.url` in logs | Scheduler logging | **N/A (Discord)** | Runtime-generated |
| 31 | `lib/guildScheduledEvents.js` | — | Discord scheduled events for LFG; no external website URL | — | — |
| 32 | `commands/spin.js` | Convex `/api/scrim-events/...` | Scrim data on website backend (see §2.2) | Same as #7 | Env-driven base |

No bot-generated links to a public website event page (e.g. `/events/{id}`) were found.

---

## 6. Button URLs and embed URLs

| Search | Result |
|--------|--------|
| `ButtonStyle.Link` / `.setURL()` | **Not used** — all buttons use `customId` (rules, bans, gamecall, roletagged, dm confirm/cancel) |
| Embed author/thumbnail/image URLs | Avatar URLs only (`whois.js`); no website links |
| Markdown links in bot messages | Tier restrictions (#1–#6), Discord channel links (#24–#28) |

---

## 7. Invite links

| Search | Result |
|--------|--------|
| `discord.gg`, `createInvite`, invite API | **Not found** |
| `commands/scrimremind.js` | Text-only mention of re-inviting the bot (no URL) |

---

## 8. OAuth redirect URLs

| # | File | URL | Purpose | Target domain | Hardcoded / env |
|---|------|-----|---------|---------------|-----------------|
| 33 | `twitchBatch.js` | `https://id.twitch.tv/oauth2/token` | Twitch client-credentials token for live stream checks | **N/A (Twitch)** | Hardcoded |

No Discord OAuth, website login, or Hercules OAuth redirect URIs exist in this repository.

---

## 9. Third-party APIs (out of migration scope)

| # | File | URL | Purpose |
|---|------|-----|---------|
| 34 | `commands/submit.js` | `https://yunite.xyz/api/v3/guild/{GUILD_ID}/tournaments/{id}/leaderboard` | Tournament score submission |
| 35 | `lib/sheets.js` | `https://www.googleapis.com/auth/spreadsheets` | Google Sheets OAuth scope |
| 36 | `lib/vodEventScan.js` | `https://api.twitch.tv/helix/...` | VOD / stream metadata |
| 37 | Various import commands | Discord CDN `attachment.url` | Ephemeral attachment fetch (not website) |

---

## 10. Deployment / infrastructure references

| # | File | Reference | Purpose |
|---|------|-----------|---------|
| 38 | `fly.toml` | `app = 'welcome-ping'` | Fly.io app name → `welcome-ping.fly.dev` hostname |
| 39 | `package.json` | `"name": "welcome-ping"` | npm package name (matches Fly app) |

Bot public hostname is determined by Fly deployment, not an env var in this codebase.

---

## 11. Recommended domain mapping

| Current | Recommended production target | Rationale |
|---------|------------------------------|-----------|
| `coedzbd.onhercules.app/*` | **`app.coedzbd.com/*`** | Same “app subdomain” pattern; tier-restrictions is an app route |
| `healthy-husky-184.convex.site` | **`CONVEX_API_BASE_URL` env** → new deployment or **`api.coedzbd.com`** | Backend HTTP; not user-facing; keep out of hardcoded defaults after cutover |
| `welcome-ping.fly.dev` | **Keep on Fly** or **`hooks.coedzbd.com`** CNAME | Inbound webhooks; update Convex + Apps Script when hostname changes |
| `coedzbd.com` (bare) | Marketing / landing only | No references in bot today |
| Discord `discord.com/channels/...` | Unchanged | Native Discord deep links |

---

## 12. Files with zero website URLs (verified)

Commands and libs checked with no Hercules/Convex/website URLs: `banexport.js`, `guardianWatch.js`, `tierClear.js`, `lfg.js`, `report.js`, `gamecall.js`, `bans.js`, `dm.js`, `checklive.js`, `vodreport.js`, `memberProfile.js`, and the majority of admin/import commands.

---

## 13. Gaps / follow-up outside this repo

1. **Convex backend project** — HTTP route handlers, outbound webhook URL to bot, CORS, any hardcoded `onhercules.app` in emails or web UI.
2. **Fly.io secrets** — `CONVEX_API_BASE_URL`, `DISCORD_SYNC_API_KEY`, `EVENT_BAN_WEBHOOK_SECRET`, `SCRIM_EVENTS_API_KEY`.
3. **Google Apps Script** — `WEBHOOK_URL` script property on Event Bans spreadsheet.
4. **Google Sheets** — Rules Modules tab content; scrim event sheet columns (content is user-authored).
5. **Yunite** — Third-party; unchanged unless Yunite guild config changes.
