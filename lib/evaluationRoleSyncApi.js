const crypto = require("crypto");
const { syncFemaleEvaluatedRoleFromPush } = require("./femalePendingRole");

const EVALUATION_ROLE_SYNC_PATH =
  process.env.EVALUATION_ROLE_SYNC_PATH ||
  "/internal/discord/evaluation-role-sync";

function getSecret() {
  return (
    process.env.EVALUATION_ROLE_SYNC_SECRET ||
    process.env.DISCORD_SYNC_API_KEY ||
    process.env.EVENT_BAN_WEBHOOK_SECRET ||
    ""
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function verifyHmacSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) {
    return false;
  }

  const provided = String(signatureHeader).replace(/^sha256=/i, "").trim();
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  if (provided.length !== expected.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

function authorize(req, rawBody) {
  const secret = getSecret();

  if (!secret) {
    return false;
  }

  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerSecret = req.headers["x-webhook-secret"] || "";

  if (bearer === secret || headerSecret === secret) {
    return true;
  }

  const signature =
    req.headers["x-webhook-signature"] ||
    req.headers["x-signature-256"] ||
    req.headers["x-evaluation-sync-signature"] ||
    "";

  return verifyHmacSignature(rawBody, signature, secret);
}

function parseEvaluationSyncPayload(body) {
  const discordId = String(
    body.discordId ??
      body.discord_id ??
      body.discordUserId ??
      body.discord_user_id ??
      ""
  ).trim();

  let evaluatedGender =
    body.evaluatedGender ??
    body.evaluated_gender ??
    body.gender ??
    body.evaluationGender ??
    body.evaluation_gender ??
    body.evaluation?.Gender ??
    body.evaluation?.gender;

  if (typeof evaluatedGender === "string") {
    evaluatedGender = Number.parseInt(evaluatedGender, 10);
  }

  const eventType =
    body.eventType ?? body.event_type ?? body.type ?? null;
  const memberId =
    body.memberId ??
    body.member_id ??
    body.playerId ??
    body.player_id ??
    null;

  return { discordId, evaluatedGender, eventType, memberId };
}

function createEvaluationRoleSyncHandler(client, { guildId } = {}) {
  return async function handleEvaluationRoleSyncRequest(req, res) {
    const path = (req.url || "/").split("?")[0];

    if (path !== EVALUATION_ROLE_SYNC_PATH) {
      return false;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method Not Allowed" });
      return true;
    }

    if (!getSecret()) {
      sendJson(res, 503, {
        ok: false,
        error:
          "EVALUATION_ROLE_SYNC_SECRET (or DISCORD_SYNC_API_KEY) is not configured on the bot"
      });
      return true;
    }

    const rawBody = await readBody(req);

    if (!authorize(req, rawBody)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" });
      return true;
    }

    if (!client.isReady()) {
      sendJson(res, 503, { ok: false, error: "Bot not ready" });
      return true;
    }

    let body;

    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
      return true;
    }

    const payload = parseEvaluationSyncPayload(body);

    if (!payload.discordId) {
      sendJson(res, 400, { ok: false, error: "discordId is required" });
      return true;
    }

    if (
      typeof payload.evaluatedGender !== "number" ||
      !Number.isFinite(payload.evaluatedGender)
    ) {
      sendJson(res, 400, {
        ok: false,
        error: "evaluatedGender must be a number"
      });
      return true;
    }

    const guild = await client.guilds.fetch(guildId).catch(() => null);

    if (!guild) {
      sendJson(res, 503, { ok: false, error: "Guild not available" });
      return true;
    }

    try {
      const result = await syncFemaleEvaluatedRoleFromPush(guild, {
        ...payload,
        source: "evaluation-push"
      });

      if (!result.ok) {
        sendJson(res, 500, { ok: false, ...result });
        return true;
      }

      sendJson(res, 200, { ok: true, ...result });
      return true;
    } catch (err) {
      console.error(
        "[EVALUATION ROLE SYNC]",
        payload.discordId,
        err?.message || err
      );
      sendJson(res, 500, {
        ok: false,
        error: err?.message || "Evaluation role sync failed"
      });
      return true;
    }
  };
}

module.exports = {
  EVALUATION_ROLE_SYNC_PATH,
  createEvaluationRoleSyncHandler
};
