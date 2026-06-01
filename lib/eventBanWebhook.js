const {
  parseRoleSyncPayload,
  payloadHasEntries
} = require("./roleSyncPayload");

const DEBOUNCE_MS = Number(process.env.EVENT_BAN_WEBHOOK_DEBOUNCE_MS || 2000);
const WEBHOOK_PATH = "/webhooks/event-bans";
const ROLE_SYNC_WEBHOOK_PATH = "/webhooks/role-sync";
const WEBHOOK_SECRET = process.env.EVENT_BAN_WEBHOOK_SECRET || "";

const WEBHOOK_PATHS = new Set([WEBHOOK_PATH, ROLE_SYNC_WEBHOOK_PATH]);

let debounceTimer = null;
let queuedPayload = { adds: [], removals: [] };
let queuedSource = "webhook";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function authorizeWebhook(req) {
  if (!WEBHOOK_SECRET) {
    return false;
  }

  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ")
    ? auth.slice(7).trim()
    : "";
  const headerSecret = req.headers["x-webhook-secret"] || "";

  return bearer === WEBHOOK_SECRET || headerSecret === WEBHOOK_SECRET;
}

function mergeQueuedPayload(body) {
  const { adds, removals } = parseRoleSyncPayload(body);
  queuedPayload.adds.push(...adds);
  queuedPayload.removals.push(...removals);
}

function schedulePushFromWebhook(client, processPayloadFn, body, source) {
  mergeQueuedPayload(body);
  queuedSource = source || body?.source || "push";

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;

    const payload = {
      adds: queuedPayload.adds,
      removals: queuedPayload.removals,
      source: queuedSource
    };

    queuedPayload = { adds: [], removals: [] };

    console.log(
      `[ROLE SYNC WEBHOOK] Applying ${payload.adds.length} add(s), ` +
        `${payload.removals.length} removal(s) (source: ${payload.source})`
    );

    processPayloadFn(client, payload, { source: payload.source }).catch(err => {
      console.error("[ROLE SYNC WEBHOOK] apply failed:", err);
    });
  }, DEBOUNCE_MS);
}

function scheduleLegacyPollFromWebhook(client, processPayloadFn, source) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;

    console.log(
      `[ROLE SYNC WEBHOOK] Legacy signal — fallback poll ` +
        `(source: ${source || "unknown"})`
    );

    processPayloadFn(client, null, { source: source || "webhook" }).catch(err => {
      console.error("[ROLE SYNC WEBHOOK] poll failed:", err);
    });
  }, DEBOUNCE_MS);
}

function createWebhookRequestHandler(client, processPayloadFn) {
  return async function handleWebhookRequest(req, res) {
    const path = (req.url || "/").split("?")[0];

    if (req.method === "GET" && (path === "/" || path === "/health")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    if (req.method !== "POST" || !WEBHOOK_PATHS.has(path)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    if (!WEBHOOK_SECRET) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: "EVENT_BAN_WEBHOOK_SECRET is not configured on the bot"
        })
      );
      return;
    }

    if (!authorizeWebhook(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
      return;
    }

    let body = null;
    let source = path === ROLE_SYNC_WEBHOOK_PATH ? "convex" : "webhook";

    try {
      const raw = await readBody(req);

      if (raw) {
        body = JSON.parse(raw);
        source = body.source || body.sheet || source;
      }
    } catch {
      // empty or non-JSON body is fine for legacy poll path
    }

    if (body && payloadHasEntries(body)) {
      schedulePushFromWebhook(client, processPayloadFn, body, source);

      res.writeHead(202, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          queued: true,
          mode: "apply",
          debounceMs: DEBOUNCE_MS
        })
      );
      return;
    }

    scheduleLegacyPollFromWebhook(client, processPayloadFn, source);

    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        queued: true,
        mode: "poll",
        debounceMs: DEBOUNCE_MS
      })
    );
  };
}

module.exports = {
  WEBHOOK_PATH,
  ROLE_SYNC_WEBHOOK_PATH,
  createWebhookRequestHandler,
  schedulePushFromWebhook,
  scheduleLegacyPollFromWebhook
};
