# Domain Cutover Checklist — Production Launch

Every URL or hostname that must be correct **before** production launch. Ordered by dependency: website/backend config first, then bot env, then code defaults, then data.

**Legend:**  
🔴 Blocker — bot or sync breaks if wrong  
🟡 User-visible — wrong links in Discord messages  
🟢 Ops/docs — update for maintainability  

---

## A. Fly.io / bot runtime environment

Set on the `welcome-ping` Fly app (or equivalent production host):

| Status | Variable | Current default / example | Required production value | Notes |
|--------|----------|---------------------------|---------------------------|-------|
| ☐ 🔴 | `CONVEX_API_BASE_URL` | `https://healthy-husky-184.convex.site` | **New production Convex HTTP URL** or `https://api.coedzbd.com` | Member sync + ban role sync + acks |
| ☐ 🔴 | `SCRIM_EVENTS_API_BASE_URL` | Falls back to `CONVEX_API_BASE_URL` | Set explicitly if scrim API differs; else same as above | Used by `/spin` |
| ☐ 🔴 | `DISCORD_SYNC_API_KEY` | — | Production API key matching Convex backend | Required for outbound Convex calls |
| ☐ 🔴 | `SCRIM_EVENTS_API_KEY` | Falls back to `DISCORD_SYNC_API_KEY` | Production key if scrim routes use separate auth | `/spin` only |
| ☐ 🔴 | `EVENT_BAN_WEBHOOK_SECRET` | — | Shared secret with Convex + Apps Script | Inbound webhook auth + API key fallback |
| ☐ 🔴 | `TIER_CLEAR_API_SECRET` | Falls back to `EVENT_BAN_WEBHOOK_SECRET` | Secret for website → bot tier wipe | If website triggers tier clear |
| ☐ 🟢 | `GUILD_ID` | `1371615693392576580` | Confirm unchanged for production guild | |

**Verify after env update:**

- ☐ 🔴 `GET {CONVEX_API_BASE_URL}/...` — smoke-test from bot machine (pending-role-syncs with auth)
- ☐ 🔴 Bot logs on boot show webhook paths and no “API key not set” warnings for enabled features
- ☐ 🔴 `GET https://welcome-ping.fly.dev/health` (or production bot URL) returns `ok`

---

## B. Convex backend (outside this repo — callers of bot)

| Status | URL / config | Current | Required production value |
|--------|--------------|---------|---------------------------|
| ☐ 🔴 | Outbound role-sync webhook | `POST https://welcome-ping.fly.dev/webhooks/role-sync` | Confirm hostname + path; update if Fly custom domain added |
| ☐ 🔴 | Webhook `Authorization` | `Bearer {EVENT_BAN_WEBHOOK_SECRET}` | Match Fly secret |
| ☐ 🔴 | Convex deployment slug | `healthy-husky-184` | New production deployment |
| ☐ 🔴 | CORS / allowed origins (if any) | — | Include `app.coedzbd.com` if browser calls Convex directly (bot uses server-side HTTP) |

**Convex HTTP routes the bot calls (must exist on production deployment):**

| Status | Method | Path |
|--------|--------|------|
| ☐ 🔴 | POST | `/api/discord/sync-member` |
| ☐ 🔴 | GET | `/api/discord/pending-role-syncs` |
| ☐ 🔴 | POST | `/api/discord/acknowledge-role-syncs` |
| ☐ 🔴 | GET | `/api/discord/pending-role-removals` |
| ☐ 🔴 | POST | `/api/discord/acknowledge-role-removals` |
| ☐ 🔴 | GET | `/api/scrim-events/by-code/{eventCode}` |
| ☐ 🔴 | POST | `/api/scrim-events/{eventId}/entries` |

---

## C. Google Apps Script (Event Bans spreadsheet)

| Status | Property | Current example | Required production value |
|--------|----------|-----------------|---------------------------|
| ☐ 🔴 | `WEBHOOK_URL` | `https://welcome-ping.fly.dev/webhooks/role-sync` | Production bot URL + `/webhooks/role-sync` |
| ☐ 🔴 | `WEBHOOK_SECRET` | Same as bot `EVENT_BAN_WEBHOOK_SECRET` | Production secret |

**File reference:** `scripts/google-apps-script-event-bans-trigger.js`

---

## D. Website app (`app.coedzbd.com`) — user-facing links

These URLs are embedded in Discord messages today as `coedzbd.onhercules.app`.

| Status | URL path | Current full URL | Required production URL |
|--------|----------|------------------|-------------------------|
| ☐ 🟡 | Tier restrictions | `https://coedzbd.onhercules.app/tier-restrictions` | `https://app.coedzbd.com/tier-restrictions` |

**Pre-launch checks:**

- ☐ 🟡 Production route live and returns 200 (not redirect loop / 404)
- ☐ 🟡 Old URL `coedzbd.onhercules.app/tier-restrictions` redirects to new URL (recommended until bot code updated)

---

## E. Bot source code — hardcoded URL updates

Update in a follow-up PR (listed here for cutover completeness):

| Status | File | Line | Current URL | Change to |
|--------|------|------|-------------|-----------|
| ☐ 🟡 | `lib/tierRestrictions.js` | 2 | `https://coedzbd.onhercules.app/tier-restrictions` | `https://app.coedzbd.com/tier-restrictions` (or env var — recommended) |
| ☐ 🟡 | `commands/scrimremind.js` | 270 | Same (duplicate) | Import `TIER_RESTRICTIONS_URL` or shared constant |
| ☐ 🔴 | `lib/discordApi.js` | 1 | `https://healthy-husky-184.convex.site` | New production default or remove default (env required) |
| ☐ 🔴 | `commands/spin.js` | 5 | `https://healthy-husky-184.convex.site` | Same; prefer importing `DEFAULT_API_BASE_URL` from `discordApi.js` |

**Indirect (no line change if #1 updated):** `lib/rulesTemplate.js`, `lib/rulesModuleDefaults.js`, `commands/rules.js`, `commands/roletagged.js`

---

## F. Google Sheets data audit

| Status | Sheet / tab | What to search | Action |
|--------|-------------|----------------|--------|
| ☐ 🟡 | Rules Modules | `onhercules.app`, `hercules.app` | Replace with `app.coedzbd.com` or rely on `{{tierUrl}}` |
| ☐ 🟢 | Scrim Events | Message content columns | User-authored; search for old domain in scheduled reminders |
| ☐ 🟢 | Rules | Preset rows | Unlikely to contain URLs; spot-check |

---

## G. Documentation updates (non-blocking for runtime)

| Status | File | URLs to update |
|--------|------|----------------|
| ☐ 🟢 | `CONVEX_ROLE_SYNC_PUSH.md` | `welcome-ping.fly.dev/webhooks/role-sync` |
| ☐ 🟢 | `DISCORD_SYNC_AUDIT.md` | `healthy-husky-184.convex.site`, `welcome-ping.fly.dev` |
| ☐ 🟢 | `scripts/google-apps-script-event-bans-trigger.js` | Comment example `WEBHOOK_URL` |

---

## H. Post-cutover smoke tests

Run in production Discord after deploy:

| Status | Test | Expected |
|--------|------|----------|
| ☐ 🔴 | New member joins | `[MEMBER SYNC]` success in logs; member appears on website |
| ☐ 🔴 | Create pending ban on website | Role applied in Discord (webhook or fallback poll within 1h) |
| ☐ 🔴 | Edit Event Bans sheet | Apps Script webhook → bot applies or polls |
| ☐ 🟡 | Post `/rules` for an event | Tier restrictions link points to `app.coedzbd.com` |
| ☐ 🟡 | Trigger scrim reminder (or dry-run) | Tier link in reminder is correct |
| ☐ 🟡 | Invalid LFG tier signup | Rejection message shows correct tier URL |
| ☐ 🔴 | `/spin` with valid event code | Loads event from production Convex |
| ☐ 🟢 | Welcome DM to test account | Discord channel links still resolve (unchanged) |

---

## I. Explicitly out of scope (no cutover action)

| URL | Reason |
|-----|--------|
| `https://discord.com/channels/...` | Discord deep links (#verify, #create-ticket, #FAQ) |
| `https://yunite.xyz/api/v3/...` | Third-party tournament API |
| `https://id.twitch.tv/oauth2/token`, `api.twitch.tv` | Twitch integration |
| `https://www.googleapis.com/auth/spreadsheets` | Google OAuth scope string |
| Discord CDN attachment URLs | Ephemeral import commands |

---

## J. Quick reference — all URLs that must change

| Priority | URL | Where configured |
|----------|-----|------------------|
| 🔴 | `https://healthy-husky-184.convex.site` | Fly env `CONVEX_API_BASE_URL`; code defaults in `lib/discordApi.js`, `commands/spin.js` |
| 🔴 | `https://welcome-ping.fly.dev/webhooks/role-sync` | Convex backend outbound webhook; Apps Script `WEBHOOK_URL` |
| 🔴 | `https://welcome-ping.fly.dev/webhooks/event-bans` | Legacy callers (if any); prefer role-sync path |
| 🟡 | `https://coedzbd.onhercules.app/tier-restrictions` | `lib/tierRestrictions.js`, `commands/scrimremind.js`; possibly Google Sheets |

**Recommended production targets:**

| Old | New |
|-----|-----|
| `https://healthy-husky-184.convex.site` | `{PROD_CONVEX_SITE}` or `https://api.coedzbd.com` |
| `https://coedzbd.onhercules.app/tier-restrictions` | `https://app.coedzbd.com/tier-restrictions` |
| `https://welcome-ping.fly.dev/...` | Same (unless custom domain) — update **callers**, not bot paths |
