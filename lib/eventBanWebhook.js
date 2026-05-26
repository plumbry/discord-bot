const DEBOUNCE_MS = Number(process.env.EVENT_BAN_WEBHOOK_DEBOUNCE_MS || 2000);
const WEBHOOK_PATH = "/webhooks/event-bans";
const WEBHOOK_SECRET = process.env.EVENT_BAN_WEBHOOK_SECRET || "";

let debounceTimer = null;

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

function scheduleSyncFromWebhook(client, syncFn, source) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;

    console.log(
      `[EVENT BAN WEBHOOK] Polling pending role syncs (source: ${source || "unknown"})`
    );

    syncFn(client).catch(err => {
      console.error("[EVENT BAN WEBHOOK] sync failed:", err);
    });
  }, DEBOUNCE_MS);
}

function createWebhookRequestHandler(client, syncFn) {
  return async function handleWebhookRequest(req, res) {
    const path = (req.url || "/").split("?")[0];

    if (req.method === "GET" && (path === "/" || path === "/health")) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    if (req.method !== "POST" || path !== WEBHOOK_PATH) {
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

    let source = "webhook";

    try {
      const raw = await readBody(req);

      if (raw) {
        const body = JSON.parse(raw);
        source = body.source || body.sheet || source;
      }
    } catch {
      // empty or non-JSON body is fine
    }

    scheduleSyncFromWebhook(client, syncFn, source);

    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        queued: true,
        debounceMs: DEBOUNCE_MS
      })
    );
  };
}

module.exports = {
  WEBHOOK_PATH,
  createWebhookRequestHandler,
  scheduleSyncFromWebhook
};
