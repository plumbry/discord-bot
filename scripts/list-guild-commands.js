require("dotenv").config();

const { REST, Routes } = require("discord.js");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID || "1371615693392576580";

if (!DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN");
  process.exit(1);
}

async function main() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  const me = await rest.get(Routes.user("@me"));
  const guild = await rest.get(
    Routes.applicationGuildCommands(me.id, GUILD_ID)
  );

  console.log(`Guild commands: ${guild.length}`);
  console.log(
    `reactforrole registered: ${guild.some(c => c.name === "reactforrole")}`
  );

  for (const name of guild.map(c => c.name).sort()) {
    console.log(`  ${name}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
