const { clearAllTierRoles } = require("./tierClear");

const TIER_CLEAR_PATH = "/api/tier-clear";
const TIER_CLEAR_STATUS_PATH = "/api/tier-clear/status";

function getSecret() {
  return (
    process.env.TIER_CLEAR_API_SECRET ||
    process.env.EVENT_BAN_WEBHOOK_SECRET ||
    ""
  );
}

function authorize(req) {
  const secret = getSecret();

  if (!secret) {
    return false;
  }

  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerSecret = req.headers["x-webhook-secret"] || "";

  return bearer === secret || headerSecret === secret;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function createTierClearHandler(client, { guildId } = {}) {
  /** @type {null | { id: string, running: boolean, dryRun: boolean, startedAt: string, finishedAt: string|null, progress: object, summary: object|null, error: string|null }} */
  let job = null;

  function startJob(dryRun) {
    const id = `tierclear-${Date.now()}`;

    job = {
      id,
      running: true,
      dryRun,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      progress: { total: 0, processed: 0, removed: 0, failed: 0 },
      summary: null,
      error: null
    };

    console.log(`🧹 Tier clear started (jobId=${id}, dryRun=${dryRun})`);

    clearAllTierRoles(client, {
      guildId,
      dryRun,
      onProgress: (progress) => {
        if (job && job.id === id) {
          job.progress = progress;
        }
      }
    })
      .then((summary) => {
        if (job && job.id === id) {
          job.summary = summary;
        }

        console.log(
          `✅ Tier clear complete — removed from ${summary.removed} members, ` +
            `failed ${summary.failed}, total ${summary.total} (dryRun=${summary.dryRun})`
        );
      })
      .catch((err) => {
        if (job && job.id === id) {
          job.error = err?.message || String(err);
        }
        console.error(`❌ Tier clear failed: ${err?.message || err}`);
      })
      .finally(() => {
        if (job && job.id === id) {
          job.running = false;
          job.finishedAt = new Date().toISOString();
        }
      });

    return job;
  }

  return async function handleTierClearRequest(req, res) {
    const path = (req.url || "/").split("?")[0];

    if (path !== TIER_CLEAR_PATH && path !== TIER_CLEAR_STATUS_PATH) {
      return false;
    }

    if (!getSecret()) {
      sendJson(res, 503, {
        ok: false,
        error: "TIER_CLEAR_API_SECRET (or EVENT_BAN_WEBHOOK_SECRET) is not configured on the bot"
      });
      return true;
    }

    if (!authorize(req)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return true;
    }

    if (path === TIER_CLEAR_STATUS_PATH) {
      if (req.method !== "GET") {
        sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
        return true;
      }

      sendJson(res, 200, { ok: true, job });
      return true;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
      return true;
    }

    if (job && job.running) {
      sendJson(res, 409, {
        ok: false,
        error: "A tier-clear job is already running",
        job
      });
      return true;
    }

    let dryRun = false;

    try {
      const raw = await readBody(req);

      if (raw) {
        const body = JSON.parse(raw);
        dryRun = Boolean(body.dryRun);
      }
    } catch {
      // empty or non-JSON body is fine; default dryRun=false
    }

    const started = startJob(dryRun);

    sendJson(res, 202, {
      ok: true,
      queued: true,
      jobId: started.id,
      dryRun,
      statusPath: TIER_CLEAR_STATUS_PATH
    });
    return true;
  };
}

module.exports = {
  TIER_CLEAR_PATH,
  TIER_CLEAR_STATUS_PATH,
  createTierClearHandler
};
