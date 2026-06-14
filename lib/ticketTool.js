const axios = require("axios");
const { PermissionFlagsBits } = require("discord.js");

const TICKET_WAIT_MS = Number(
  process.env.TICKET_TOOL_WAIT_MS || 30000
);

function buildNewCommand(userId, reason) {
  const prefix = process.env.TICKET_TOOL_COMMAND_PREFIX || "$new";
  const base = `${prefix} <@${userId}>`;

  if (reason?.trim()) {
    return `${base} ${reason.trim()}`;
  }

  return base;
}

function isTicketChannelForUser(channel, userId, categoryId) {
  if (!channel?.isTextBased?.()) {
    return false;
  }

  if (categoryId && channel.parentId !== categoryId) {
    return false;
  }

  const overwrite = channel.permissionOverwrites?.cache?.get(userId);

  return overwrite?.allow?.has(PermissionFlagsBits.ViewChannel) ?? false;
}

function waitForTicketChannel(client, guildId, userId, categoryId, startedAt) {
  return new Promise(resolve => {
    const matches = channel => {
      if (channel.guild?.id !== guildId) {
        return false;
      }

      if (channel.createdTimestamp < startedAt - 2000) {
        return false;
      }

      return isTicketChannelForUser(channel, userId, categoryId);
    };

    const finish = channel => {
      cleanup();
      resolve(channel);
    };

    const onCreate = channel => {
      if (matches(channel)) {
        finish(channel);
      }
    };

    const onUpdate = (_oldChannel, channel) => {
      if (matches(channel)) {
        finish(channel);
      }
    };

    const timer = setTimeout(async () => {
      cleanup();

      try {
        const guild = await client.guilds.fetch(guildId);
        const found = await findTicketChannel(guild, userId, {
          categoryId,
          createdAfter: startedAt - 2000
        });
        resolve(found);
      } catch {
        resolve(null);
      }
    }, TICKET_WAIT_MS);

    function cleanup() {
      clearTimeout(timer);
      client.off("channelCreate", onCreate);
      client.off("channelUpdate", onUpdate);
    }

    client.on("channelCreate", onCreate);
    client.on("channelUpdate", onUpdate);
  });
}

async function findTicketChannel(guild, userId, { categoryId, createdAfter }) {
  await guild.channels.fetch();

  const matches = guild.channels.cache
    .filter(channel => {
      if (createdAfter && channel.createdTimestamp < createdAfter) {
        return false;
      }

      return isTicketChannelForUser(channel, userId, categoryId);
    })
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

  return matches.first() ?? null;
}

async function createViaApi({ guildId, panelId, userId, reason, apiKey }) {
  const response = await axios.post(
    "https://api.ticket-tool.app/v1/tickets",
    {
      guildId,
      panelId,
      userId,
      reason: reason?.trim() || undefined
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 15000,
      validateStatus: status => status >= 200 && status < 300
    }
  );

  return response.data;
}

function extractChannelIdFromApiResponse(data) {
  return (
    data?.channelId ||
    data?.channel?.id ||
    data?.ticket?.channelId ||
    data?.ticket?.channel?.id ||
    null
  );
}

function buildSetupError(helperBotId, triggerChannelId) {
  return (
    "Ticket Tool did not open a ticket.\n\n" +
    "**Setup checklist:**\n" +
    `1. Ticket Tool dashboard → **Server Configs** → **Bot** → add Helper Bot ID:\n` +
    `\`${helperBotId}\`\n` +
    `(Ticket Tool ignores other bots unless whitelisted here.)\n` +
    `2. Panel Configs → select the **In Game Report** panel (not the main multipanel) → **Command Style** → enable \`$new\`\n` +
    `3. Set **#create-ticket** (<#${triggerChannelId}>) as the monitored channel\n` +
    "4. Enable **Delete command after creating ticket** (optional)\n" +
    "5. Helper Bot needs **Send Messages** in that channel"
  );
}

async function openInGameReportTicket(client, {
  guildId,
  userId,
  reason,
  triggerChannelId,
  categoryId,
  apiKey,
  panelId,
  helperBotId
}) {
  if (apiKey && panelId) {
    try {
      const data = await createViaApi({
        guildId,
        panelId,
        userId,
        reason,
        apiKey
      });
      const channelId = extractChannelIdFromApiResponse(data);

      if (channelId) {
        return client.channels.fetch(channelId);
      }
    } catch (err) {
      console.error(
        "[TICKET TOOL API]",
        err?.response?.data || err?.message || err
      );
    }
  }

  if (!triggerChannelId) {
    throw new Error(
      "No Ticket Tool trigger channel configured. " +
        "Set TICKET_TOOL_INGAME_NEW_CHANNEL_ID or CREATE_TICKET_CHANNEL_ID."
    );
  }

  const guild = await client.guilds.fetch(guildId);
  const triggerChannel = await guild.channels.fetch(triggerChannelId);

  if (!triggerChannel?.isTextBased?.()) {
    throw new Error(
      "TICKET_TOOL_INGAME_NEW_CHANNEL_ID is not a text channel."
    );
  }

  const botMember = triggerChannel.guild?.members?.me;
  const sendPerms = botMember
    ? triggerChannel.permissionsFor(botMember)
    : null;

  if (
    sendPerms &&
    !sendPerms.has(PermissionFlagsBits.SendMessages)
  ) {
    throw new Error(
      `Helper Bot cannot **Send Messages** in <#${triggerChannel.id}>.\n\n` +
        `In Discord: **#${triggerChannel.name}** → Edit Channel → Permissions → ` +
        `add Helper Bot → enable **View Channel** and **Send Messages**.`
    );
  }

  const startedAt = Date.now();
  const commandText = buildNewCommand(userId, reason);

  const waitPromise = waitForTicketChannel(
    client,
    guildId,
    userId,
    categoryId || null,
    startedAt
  );

  console.log(
    `[TICKET TOOL] sending trigger in #${triggerChannel.id}: ${commandText}`
  );

  await triggerChannel.send(commandText);

  const ticketChannel = await waitPromise;

  if (!ticketChannel) {
    throw new Error(
      buildSetupError(helperBotId || client.user?.id, triggerChannelId)
    );
  }

  console.log(
    `[TICKET TOOL] ticket channel ready: #${ticketChannel.name} (${ticketChannel.id})`
  );

  return ticketChannel;
}

module.exports = {
  buildNewCommand,
  buildSetupError,
  openInGameReportTicket
};
