const http = require("http");

const HTTP_PORT = Number(process.env.PORT) || 8080;
const HTTP_HOST = process.env.HOST || "0.0.0.0";

/** @type {import("discord.js").Client | null} */
let httpHealthClient = null;

/** @type {((req: import("http").IncomingMessage, res: import("http").ServerResponse) => Promise<void> | void) | null} */
let httpMainHandler = null;

function isHealthCheckRequest(req) {
  const path = (req.url || "/").split("?")[0];
  return req.method === "GET" && (path === "/" || path === "/health");
}

const listenPromise = new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    if (isHealthCheckRequest(req)) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(httpHealthClient?.isReady() ? "ok" : "starting");
      return;
    }

    if (!httpMainHandler) {
      res.writeHead(503, { "Content-Type": "text/plain" });
      res.end("starting");
      return;
    }

    Promise.resolve(httpMainHandler(req, res)).catch(err => {
      console.error("[HTTP]", err);

      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      }
    });
  });

  server.on("error", reject);

  server.listen(HTTP_PORT, HTTP_HOST, () => {
    console.log(`🌐 HTTP health server on ${HTTP_HOST}:${HTTP_PORT}`);
    resolve(server);
  });
});

function setHealthClient(client) {
  httpHealthClient = client;
}

function setMainHandler(handler) {
  httpMainHandler = handler;
}

module.exports = {
  listenPromise,
  setHealthClient,
  setMainHandler
};
