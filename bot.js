console.log("STEP 1: START");

const { Client, GatewayIntentBits } = require("discord.js");

console.log("STEP 2: DISCORD IMPORTED");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  console.log("✅ Logged in as", client.user.tag);
});

client.login(process.env.DISCORD_TOKEN)
  .then(() => console.log("STEP 3: LOGIN SUCCESS"))
  .catch(err => console.error("LOGIN ERROR:", err));