const { listenPromise } = require("./lib/flyHealth");

listenPromise
  .then(() => {
    require("./bot");
  })
  .catch(err => {
    console.error("❌ Health server failed to start:", err);
    process.exit(1);
  });
