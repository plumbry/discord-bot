const VOD_PUBLISH_REPORT_CHANNEL_ID = "1471082166535454780";

function formatUtc(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;

  return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function chunkDiscordMessages(text, limit = 2000) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > limit) {
      if (current) chunks.push(current);
      current = line.length > limit ? line.slice(0, limit) : line;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function scanResultsToPublishEntries(results) {
  return results.map(r => {
    if (!r.streamer) {
      return {
        streamerMention: r.members.map(m => `<@${m}>`).join(" "),
        twitch: null,
        publishedAt: null,
        createdAt: null
      };
    }

    return {
      streamerMention: `<@${r.streamer}>`,
      twitch: r.twitch,
      publishedAt: r.publishedAt,
      createdAt: r.createdAt
    };
  });
}

async function postVodPublishReport(client, {
  categoryName,
  date,
  startTime,
  endTime,
  entries
}) {
  const reportChannel = await client.channels
    .fetch(VOD_PUBLISH_REPORT_CHANNEL_ID)
    .catch(() => null);

  if (!reportChannel?.isTextBased()) {
    console.warn(
      "VOD publish report: channel unavailable",
      VOD_PUBLISH_REPORT_CHANNEL_ID
    );
    return;
  }

  const header = [
    `**VOD publish report** — ${categoryName}`,
    `Event window: ${date} ${startTime}–${endTime} UTC`,
    ""
  ].join("\n");

  const lines = entries.map(entry => {
    if (!entry.twitch) {
      return `• ${entry.streamerMention} — no stream link`;
    }
    if (!entry.publishedAt) {
      return `• ${entry.streamerMention} (**${entry.twitch}**) — no VOD overlapping event window`;
    }

    return `• ${entry.streamerMention} (**${entry.twitch}**) — created ${formatUtc(entry.createdAt)}, published ${formatUtc(entry.publishedAt)}`;
  });

  const body = lines.length ? lines.join("\n") : "_No accepted teams._";
  const messages = chunkDiscordMessages(`${header}${body}`);

  for (const content of messages) {
    await reportChannel.send({ content });
  }
}

module.exports = {
  postVodPublishReport,
  scanResultsToPublishEntries
};
