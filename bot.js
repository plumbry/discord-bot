console.log("STEP 1: START");

const { Client, GatewayIntentBits } = require("discord.js");

console.log("STEP 2: DISCORD IMPORTED");

// 👇 ADD THIS LINE
require("./welcome-ping");

console.log("STEP 3: WELCOME MODULE LOADED");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("clientReady", () => {
  console.log("✅ Logged in as", client.user.tag);
});

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("STEP 4: LOGIN SUCCESS"))
  .catch(err => console.error("LOGIN ERROR:", err));