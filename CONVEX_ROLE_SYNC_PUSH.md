# Convex backend: Phase 1 role-sync push

The bot now accepts **push webhooks** for ban/probation role sync. Until Convex sends these, the bot relies on:

- **Startup drain poll** (once on boot)
- **Legacy sheet webhook** (empty body → one poll)
- **Manual** `/eventban sync`

Bans expire at midnight; no periodic fallback poll runs by default. Set `ROLE_SYNC_FALLBACK_POLL_MS` if you want a safety net (e.g. `86400000` for daily).

## Endpoint

```
POST https://welcome-ping.fly.dev/webhooks/role-sync
Authorization: Bearer <EVENT_BAN_WEBHOOK_SECRET>
Content-Type: application/json
```

Legacy path `/webhooks/event-bans` accepts the same payload shape.

## Payload

### Assign roles

```json
{
  "action": "assign",
  "source": "convex",
  "entries": [
    {
      "_id": "<ban document id>",
      "discordId": "<discord user snowflake>",
      "banType": "minor event ban",
      "roleSyncRequestedAt": "2026-05-31T12:00:00.000Z"
    }
  ]
}
```

Valid `banType` values (case-insensitive): `minor event ban`, `major event ban`, `event ban`, `probation`.

### Remove roles

```json
{
  "action": "remove",
  "source": "convex",
  "entries": [
    {
      "_id": "<ban or pendingRoleRemoval id>",
      "discordId": "<discord user snowflake>",
      "banType": "probation",
      "source": "pendingRoleRemovals"
    }
  ]
}
```

For removals from `pendingRoleRemovals`, set `"source": "pendingRoleRemovals"` on the entry (matches existing ack routing).

### Batch both directions

```json
{
  "source": "convex",
  "adds": [ { "_id": "...", "discordId": "...", "banType": "..." } ],
  "removals": [ { "_id": "...", "discordId": "...", "banType": "...", "source": "pendingRoleRemovals" } ]
}
```

## When to push

Call the webhook when a record becomes pending for Discord role apply or remove:

- Ban/probation **created** or **updated** on the website
- Ban/probation **expired** (removal entry)
- Manual unblock / role clear queued

## Bot behavior

1. Applies roles via existing Discord API logic
2. POSTs ack to Convex (`/api/discord/acknowledge-role-syncs` or `acknowledge-role-removals`)
3. **No Convex GET** on push path

## Retry

If the bot returns non-2xx or is offline, keep the row `pending` and retry the webhook with backoff. Convex should push again at midnight expiry; `/eventban sync` drains the queue manually if needed.

## Response

```json
{ "ok": true, "queued": true, "mode": "apply", "debounceMs": 2000 }
```

Entries are debounced 2s server-side; batch multiple rows in one POST when possible.
