const {
  MESSAGE_SCAN_LIMIT,
  getNonBotMentionedUsers,
  messageHasExactTaggedPlayers
} = require("./signupTeamScan");

const {
  buildMemberNameLookup,
  messageHasMentions,
  messageHasValidUntaggedFormat,
  parseUntaggedSlots,
  resolveUntaggedTeamUsers
} = require("./untaggedSignupScan");

const MODE_LABELS = {
  1: "Solos",
  2: "Duos",
  3: "Trios",
  4: "Squads"
};

function formatTeamUserLine(user) {
  return `\`${user.username}\``;
}

function formatUnresolvedEntry(message, resolved) {
  const preview = (message.content || "(empty)")
    .replace(/\n/g, " ")
    .slice(0, 120);

  if (resolved.reason === "not_found") {
    return `• "${preview}" — no member named **${resolved.slot}**`;
  }

  if (resolved.reason === "ambiguous") {
    const options = (resolved.matches || [])
      .map(member => member.user.username)
      .join(", ");

    return `• "${preview}" — **${resolved.slot}** matches: ${options}`;
  }

  if (resolved.reason === "invalid_format") {
    return `• "${preview}" — invalid signup format`;
  }

  return `• "${preview}" — could not resolve`;
}

async function scanChannelTeams(channel, guild, requiredTeamSize) {
  await guild.members.fetch();

  const memberLookup = buildMemberNameLookup(guild);
  const messages = await channel.messages.fetch({
    limit: MESSAGE_SCAN_LIMIT
  });

  const orderedMessages = [...messages.values()].reverse();
  const teams = [];
  const unresolved = [];

  for (const message of orderedMessages) {
    if (message.author?.bot) {
      continue;
    }

    if (messageHasExactTaggedPlayers(message, requiredTeamSize)) {
      const users = getNonBotMentionedUsers(message);

      teams.push({
        number: teams.length + 1,
        messageId: message.id,
        source: "tagged",
        raw: message.content,
        users
      });
      continue;
    }

    if (
      !messageHasMentions(message) &&
      messageHasValidUntaggedFormat(message, requiredTeamSize)
    ) {
      const resolved = resolveUntaggedTeamUsers(
        message,
        requiredTeamSize,
        memberLookup
      );

      if (resolved.ok) {
        teams.push({
          number: teams.length + 1,
          messageId: message.id,
          source: "untagged",
          raw: message.content,
          users: resolved.users,
          typedNames: parseUntaggedSlots(message.content, requiredTeamSize)
        });
      } else {
        unresolved.push({
          message,
          resolved
        });
      }
    }
  }

  return {
    teams,
    unresolved,
    modeLabel: MODE_LABELS[requiredTeamSize] || String(requiredTeamSize)
  };
}

function buildTeamNamesReport({
  teams,
  unresolved,
  modeLabel,
  channel
}) {
  const lines = [];

  lines.push(
    `**${modeLabel} signups in ${channel}** — ${teams.length} team(s) resolved`
  );

  if (teams.length === 0) {
    lines.push("");
    lines.push(
      "No valid signups found. Use @mentions or plain names (`Alice x Bob` for teams, one name for solos)."
    );
  } else {
    lines.push("");

    for (const team of teams) {
      const handles = team.users.map(formatTeamUserLine).join(" · ");
      const typed =
        team.source === "untagged" && team.typedNames?.length
          ? ` _(typed: ${team.typedNames.join(" x ")})_`
          : "";

      lines.push(`**Team ${team.number}** — ${handles}${typed}`);
    }
  }

  if (unresolved.length > 0) {
    lines.push("");
    lines.push(`**Could not resolve (${unresolved.length}):**`);

    for (const entry of unresolved) {
      lines.push(formatUnresolvedEntry(entry.message, entry.resolved));
    }
  }

  return lines.join("\n");
}

function splitDiscordMessages(text, limit = 1900) {
  if (text.length <= limit) {
    return [text];
  }

  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    const next = current ? `${current}\n${line}` : line;

    if (next.length > limit) {
      if (current) {
        chunks.push(current);
      }

      if (line.length > limit) {
        chunks.push(line.slice(0, limit));
        current = line.slice(limit);
      } else {
        current = line;
      }
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

module.exports = {
  buildTeamNamesReport,
  formatTeamUserLine,
  scanChannelTeams,
  splitDiscordMessages
};
