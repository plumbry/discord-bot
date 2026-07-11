/**
 * Push guild slash commands to Discord (same set as bot.js on ready).
 *
 * Usage (from discord-bot folder):
 *   npm install
 *   npm run register-commands
 *
 * Requires in .env:
 *   DISCORD_TOKEN  — bot token
 *   GUILD_ID       — optional, defaults to your server
 *
 * DISCORD_CLIENT_ID is optional; if omitted, the script reads the bot user id from @me.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID || '1371615693392576580';

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

function loadCommandsFromFolder() {
  const commandsPath = path.join(__dirname, '..', 'commands');
  const body = [];

  for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    if (!command?.data?.toJSON) continue;
    if (command.decommissioned) continue;
    body.push(command.data.toJSON());
  }

  return body;
}

function loadExtraCommands() {
  const extra = [];

  try {
    const { verifyCommand } = require('../welcome-ping');
    if (verifyCommand?.toJSON) extra.push(verifyCommand.toJSON());
  } catch (err) {
    console.warn('verify command not loaded:', err.message);
  }

  try {
    const { boomerCommand } = require('../welcome-ping');
    if (boomerCommand?.toJSON) extra.push(boomerCommand.toJSON());
  } catch (err) {
    console.warn('boomer command not loaded:', err.message);
  }

  try {
    const { eventBanCommand } = require('../event-bans/eventBans');
    if (eventBanCommand?.toJSON) extra.push(eventBanCommand.toJSON());
  } catch (err) {
    console.warn('eventban command not loaded:', err.message);
  }

  return extra;
}

function logCommandSummary(body) {
  for (const json of body) {
    const opts = (json.options || []).map((o) => o.name).join(', ') || '(none)';
    console.log(`  ${json.name}: ${opts}`);
  }
}

async function main() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  let clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    const me = await rest.get(Routes.user('@me'));
    clientId = me.id;
    console.log(`Using bot application id from @me: ${clientId}`);
  }

  const body = [...loadCommandsFromFolder(), ...loadExtraCommands()];

  console.log(`\nRegistering ${body.length} guild commands to ${GUILD_ID}:\n`);
  logCommandSummary(body);

  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  console.log('Cleared global slash commands.');

  await rest.put(Routes.applicationGuildCommands(clientId, GUILD_ID), { body });

  console.log(`\nDone. Registered ${body.length} guild commands.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
