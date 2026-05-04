console.log("=== MINIMAL START ===");

const http = require("http");

const PORT = process.env.PORT || 8080;

http.createServer((req, res) => {
  res.end("OK");
}).listen(PORT, () => {
  console.log("Server running on port", PORT);
});