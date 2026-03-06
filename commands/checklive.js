const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const fetch = require("node-fetch");

const TWITCH_REGEX = /twitch\.tv\/([a-zA-Z0-9_]+)(?:\/|$)/gi;

async function getAccessToken() {

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      `client_id=${process.env.TWITCH_CLIENT_ID}` +
      `&client_secret=${process.env.TWITCH_CLIENT_SECRET}` +
      `&grant_type=client_credentials`
  });

  const data = await res.json();
  return data.access_token;

}

async function getTwitchUsers(channel) {

  let lastId;
  const users = new Set();

  while (true) {

    const options = { limit: 100 };

    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);
    if (!messages.size) break;

    messages.forEach(msg => {

      const matches = [...msg.content.matchAll(TWITCH_REGEX)];

      matches.forEach(match => {
        users.add(match[1].toLowerCase());
      });

    });

    lastId = messages.last().id;

  }

  return [...users];

}

async function checkLiveStatus(users, token) {

  if (!users.length) return { live: [], offline: [] };

  const url =
    "https://api.twitch.tv/helix/streams?" +
    users.map(u => `user_login=${u}`).join("&");

  const res = await fetch(url, {
    headers: {
      "Client-ID": process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`
    }
  });

  const data = await res.json();

  const liveUsers = data.data.map(stream => stream.user_login.toLowerCase());

  const live = [];
  const offline = [];

  users.forEach(user => {

    if (liveUsers.includes(user)) {
      live.push(user);
    } else {
      offline.push(user);
    }

  });

  return { live, offline };

}

module.exports = {

  data: new SlashCommandBuilder()
    .setName("checklive")
    .setDescription("Check which submitted Twitch links are live")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {

    await interaction.reply({
      content: "Checking Twitch streams...",
      ephemeral: true
    });

    const users = await getTwitchUsers(interaction.channel);

    if (!users.length) {

      await interaction.followUp({
        content: "No Twitch links found in this channel.",
        ephemeral: true
      });

      return;

    }

    const token = await getAccessToken();

    const { live, offline } = await checkLiveStatus(users, token);

    let output = `Checked ${users.length} Twitch channels\n\n`;

    if (live.length) {
      output += `🟢 LIVE (${live.length})\n`;
      output += live.join("\n") + "\n\n";
    }

    if (offline.length) {
      output += `🔴 OFFLINE (${offline.length})\n`;
      output += offline.join("\n");
    }

    await interaction.followUp({
      content: output,
      ephemeral: true
    });

  }

};