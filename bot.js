// ================= STAFF PANEL BUTTONS =================

if (interaction.isButton()) {

  if (!interaction.customId.startsWith("staff_")) return;

  const parts = interaction.customId.split("_");
  const action = parts.slice(0,3).join("_");
  const channelId = parts[3];

  const call = activeCalls.get(channelId);

  if (!call) {
    return interaction.reply({
      content: "No active game call found.",
      ephemeral: true
    });
  }

  const gameChannel = interaction.guild.channels.cache.get(channelId);

  if (action === "staff_cancel_game") {

    clearTimeout(call.t1);
    clearTimeout(call.t2);

    activeCalls.delete(channelId);

    await gameChannel.send("❌ **Game call cancelled by staff.**");

    return interaction.reply({
      content: "Game cancelled.",
      ephemeral: true
    });

  }

  if (action === "staff_stop_followups") {

    clearTimeout(call.t1);
    clearTimeout(call.t2);

    return interaction.reply({
      content: "Follow-ups stopped.",
      ephemeral: true
    });

  }

  if (action === "staff_lock_chat") {

    const everyone = interaction.guild.roles.everyone;

    await gameChannel.permissionOverwrites.edit(everyone, {
      SendMessages: false
    });

    return interaction.reply({
      content: "Chat locked.",
      ephemeral: true
    });

  }

  if (action === "staff_check_streams") {

    const command = interaction.client.commands.get("teamsstreamcheck");

    if (command) {

      await command.execute({
        ...interaction,
        channel: gameChannel
      });

    }

    return interaction.reply({
      content: "Running stream check.",
      ephemeral: true
    });

  }

}