/**
 * Show what Discord currently has registered for this bot.
 *
 *   node scripts/check-discord-commands.js
 */
require('dotenv').config();

const { REST, Routes } = require('discord.js');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID || '1371615693392576580';

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

function printSubmit(label, commands) {
  const submit = commands.find((c) => c.name === 'submit');
  if (!submit) {
    console.log(`  ${label}: (no /submit)`);
    return;
  }
  const opts = (submit.options || []).map((o) => o.name).join(', ') || '(none)';
  console.log(`  ${label}:`);
  console.log(`    description: ${submit.description}`);
  console.log(`    options: ${opts}`);
}

async function main() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const me = await rest.get(Routes.user('@me'));
  const clientId = process.env.DISCORD_CLIENT_ID || me.id;

  const global = await rest.get(Routes.applicationCommands(clientId));
  const guild = await rest.get(
    Routes.applicationGuildCommands(clientId, GUILD_ID)
  );

  console.log(`Bot: ${me.username} (${clientId})`);
  console.log(`Guild: ${GUILD_ID}\n`);

  printSubmit('GLOBAL /submit', global);
  printSubmit('GUILD /submit', guild);

  if (global.some((c) => c.name === 'submit')) {
    console.log(
      '\nStale GLOBAL /submit found — run: npm run register-commands'
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
