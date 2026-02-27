if (sub === "summary") {
  const activeEvents = rows.filter(
    r => r[2] !== "Probation" && Number(r[4]) > 0
  );

  const probations = rows.filter(
    r => r[2] === "Probation" && r[9] !== "ENDED"
  );

  const uniquePlayers = [
    ...new Set(activeEvents.map(r => r[1]))
  ];

  const playerList = uniquePlayers.length
    ? uniquePlayers.join(", ")
    : "None";

  return interaction.editReply(
    `📊 **Event Ban Summary**\n\n` +
    `Active Event Bans: **${activeEvents.length}**\n` +
    `Active Probations: **${probations.length}**\n\n` +
    `👥 **Banned Players:**\n${playerList}`
  );
}

if (sub === "history") {
  const u = interaction.options.getUser("user");
  const history = rows.filter(r => r[0] === u.id);

  if (!history.length)
    return interaction.editReply({ content: "No history found.", ephemeral: true });

  const out = history
    .reverse()
    .map(r =>
      r[2] === "Probation"
        ? formatProbation(r)
        : formatEventBan(r)
    )
    .join("\n\n");

  return interaction.editReply({ content: out, ephemeral: true });
}

if (sub === "probation") {
  const u = interaction.options.getUser("user");
  const days = interaction.options.getInteger("days");
  const start = interaction.options.getString("start");
  const reason = interaction.options.getString("reason");

  const end = addDays(start, days);

  const row = [
    u.id, u.username, "Probation",
    days.toString(), "",
    start, end,
    reason,
    interaction.user.tag,
    "PROBATION"
  ];

  await channel.send(formatProbation(row));

  rows.push(row);
  await writeRows(rows);
  await logAudit("PROBATION_APPLY", interaction.user, u);

  return interaction.editReply("Probation applied.");
}