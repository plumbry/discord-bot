require("dotenv").config();

const { Client, GatewayIntentBits, Routes } = require("discord.js");

const GUILD_ID = process.env.GUILD_ID || "1371615693392576580";

(async () => {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildScheduledEvents]
  });

  await client.login(process.env.DISCORD_TOKEN);

  const guild = await client.guilds.fetch(GUILD_ID);
  console.log("Guild:", guild.name, guild.id);

  try {
    const restList = await client.rest.get(Routes.guildScheduledEvents(GUILD_ID));
    console.log("REST count:", Array.isArray(restList) ? restList.length : typeof restList);
    if (Array.isArray(restList)) {
      for (const event of restList.slice(0, 10)) {
        console.log(
          `  - ${event.name} | id=${event.id} | status=${event.status} | start=${event.scheduled_start_time}`
        );
      }
    }
  } catch (err) {
    console.error("REST error:", err?.code, err?.status, err?.message, err?.rawError);
  }

  try {
    const collection = await guild.scheduledEvents.fetch({ force: true });
    console.log("Manager count:", collection.size);
  } catch (err) {
    console.error("Manager error:", err?.message || err);
  }

  await client.destroy();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
