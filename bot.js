const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ================= ERROR HANDLING =================

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

// ================= IMPORT COMMAND MODULES =================

const {
  verifyCommand,
  handleVerify,
  handleWelcome
} = require("./welcome ping");

const {
  eventBanCommand,
  recentBanCommand,
  myBanCommand,
  handleEventBan,
  handleRecentBan,
  handleMyBan
} = require("./event bans/eventBans");

const { startBanExpiryChecker } = require("./banExpiryChecker");

const dm = require("./commands/dm");

// ================= GAMECALL STATE =================

const gamecallModule = require("./commands/gamecall");
const activeCalls = gamecallModule.activeCalls || new Map();

// ================= CONSTANTS =================

const GUILD_ID = "1371615693392576580";
const YUNITE_LOG_CHANNEL = "1371615781393137788";

// ================= CLIENT =================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

client.commands = new Map();

// ================= LOAD COMMAND FILES =================

const commandsPath = path.join(__dirname, "commands");

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith(".js"));

for (const file of commandFiles) {

  try {

    const command = require(`./commands/${file}`);

    if (!command?.data || !command?.execute) {
      console.log(`Skipping invalid command: ${file}`);
      continue;
    }

    client.commands.set(command.data.name, command);

  } catch (err) {

    console.error(`Error loading command: ${file}`);
    console.error(err);

  }

}

// ================= READY =================

client.once("ready", async () => {

  console.log(`Logged in as ${client.user.tag}`);

  startBanExpiryChecker(client);

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

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commandJSON }
  );

  if (dm.startDMScheduler) {
    dm.startDMScheduler(client);
  }

});

// ================= INTERACTIONS =================

client.on("interactionCreate", async interaction => {

  if (interaction.isChatInputCommand()) {

    if (interaction.commandName === "verify")
      return handleVerify(interaction);

    if (interaction.commandName === "eventban")
      return handleEventBan(interaction);

    if (interaction.commandName === "recentban")
      return handleRecentBan(interaction);

    if (interaction.commandName === "myban") {
      await interaction.deferReply({ ephemeral: true });
      return handleMyBan(interaction);
    }

    if (interaction.commandName === "dm" && dm.handleDM)
      return dm.handleDM(interaction);

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
    }

  }

  // ================= BUTTONS =================

  if (interaction.isButton()) {

    const active = activeCalls.get(interaction.channel.id);

    if (!active) {
      return interaction.reply({
        content: "No active game call found.",
        ephemeral: true
      });
    }

    if (interaction.customId === "gamecall_stop_followups") {

      await interaction.deferReply({ ephemeral: true });

      clearTimeout(active.t1);
      clearTimeout(active.t2);

      return interaction.editReply({
        content: "Automated WHO IS NOT IN follow ups stopped."
      });

    }

    if (interaction.customId === "gamecall_cancel") {

      await interaction.deferReply({ ephemeral: true });

      clearTimeout(active.t1);
      clearTimeout(active.t2);

      const msg = await interaction.channel.messages.fetch(active.messageId);

      const lines = msg.content.split("\n");

      const game = active.gameNumber;

      const regionMatch = lines[0].match(/GAME\s+\d+\s+(\S+)/i);
      const region = regionMatch ? regionMatch[1] : "";

      lines[0] = `GAME ${game} ${region} CODE CANCELLED`;

      await msg.edit(lines.join("\n"));

      const rolePing = `<@&${active.roleId}>`;

      await interaction.channel.send(
`🚨 **CODE CANCELLED** ${rolePing}`
      );

      activeCalls.delete(interaction.channel.id);

      return interaction.editReply({
        content: `Game ${game} cancelled.`
      });

    }

    if (interaction.customId === "gamecall_override") {

      const modal = new ModalBuilder()
        .setCustomId("override_modal")
        .setTitle("Override Game Code");

      const input = new TextInputBuilder()
        .setCustomId("new_code")
        .setLabel("New Game Code")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(input)
      );

      return interaction.showModal(modal);

    }

  }

  // ================= MODALS =================

  if (interaction.isModalSubmit()) {

    if (interaction.customId === "override_modal") {

      const newCode = interaction.fields.getTextInputValue("new_code");

      const active = activeCalls.get(interaction.channel.id);

      if (!active) return;

      const msg = await interaction.channel.messages.fetch(active.messageId);

      const lines = msg.content.split("\n");

      const match = lines[0].match(/^GAME\s+(\d+)\s+(\S+)/i);

      const game = match[1];
      const region = match[2];

      lines[0] = `GAME ${game} ${region} CODE ${newCode}`;

      await msg.edit(lines.join("\n"));

      const rolePing = `<@&${active.roleId}>`;

      await interaction.channel.send(
`🚨 **NEW CODE** ${rolePing}
CODE ${newCode}`
      );

      return interaction.reply({
        content: `Game code updated to **${newCode}**.`,
        ephemeral: true
      });

    }

  }

});

// ================= YUNITE DROP MAP AUTOMATION =================

client.on("messageCreate", async message => {

  if (!message.author.bot) return;
  if (message.channel.id !== YUNITE_LOG_CHANNEL) return;

  if (!message.content.toLowerCase().includes("matches are running")) return;

  const guild = message.guild;

  let tournamentName = null;

  const lines = message.content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes("tournament")) {
      tournamentName = lines[i + 1] || lines[i];
      break;
    }
  }

  if (!tournamentName) {
    const match = message.content.match(/Tournament\s*(.+?)\s*-?\s*Matches/i);
    if (match) tournamentName = match[1];
  }

  if (!tournamentName) {
    console.log("Could not detect tournament name.");
    return;
  }

  const lowerTournament = tournamentName.toLowerCase();

  const category = guild.channels.cache.find(c =>
    c.type === 4 &&
    lowerTournament.includes(c.name.toLowerCase())
  );

  if (!category) {
    console.log("No category match for:", tournamentName);
    return;
  }

  const dropmapChannel = guild.channels.cache.find(c =>
    c.parentId === category.id &&
    c.name.toLowerCase().includes("dropmap")
  );

  if (!dropmapChannel) {
    console.log("No dropmap channel found in:", category.name);
    return;
  }

  dropmapChannel.send("🚫 **DROPMAP CLOSED — CHANGES WILL COUNT FOR NEXT GAME**");

});

// ================= MEMBER JOIN =================

client.on("guildMemberAdd", handleWelcome);

client.login(process.env.DISCORD_TOKEN);