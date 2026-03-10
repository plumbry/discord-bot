client.once("clientReady", async () => {

  console.log(`🤖 Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" })
    .setToken(process.env.DISCORD_TOKEN);

  const commands = [
    verifyCommand,
    eventBanCommand,
    recentBanCommand,
    myBanCommand
  ];

  for (const command of client.commands.values()) {
    commands.push(command.data);
  }

  const commandJSON = commands
    .filter(c => c && typeof c.toJSON === "function")
    .map(c => c.toJSON());

  try {

    console.log("🧹 Clearing existing guild commands...");

    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: [] }
    );

    console.log("🔄 Registering slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commandJSON }
    );

    console.log("✅ Slash commands rebuilt");

  } catch (err) {

    console.error("❌ Command registration failed");
    console.error(err);

  }

  if (dm.startDMScheduler) {
    dm.startDMScheduler(client);
  }

});