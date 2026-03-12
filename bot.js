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

// ================= VERIFY / WELCOME =================

const {
  verifyCommand,
  handleVerify,
  handleWelcome
} = require("./welcome ping");

// ================= EVENT BANS =================

const {
  eventBanCommand,
  recentBanCommand,
  myBanCommand,
  handleEventBan,
  handleRecentBan,
  handleMyBan
} = require("./event bans/eventBans");

// ================= BAN EXPIRY =================

const { startBanExpiryChecker } = require("./banExpiryChecker");

// ================= DM SYSTEM =================

const dm = require("./commands/dm");

// ================= GAMECALL STATE =================

const gamecallModule = require("./commands/gamecall");
const activeCalls = gamecallModule.activeCalls || new Map();

// ================= CONSTANTS =================

const GUILD_ID = "1371615693392576580";

// ================= CLIENT =================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.commands = new Map();

// ================= LOAD COMMANDS =================

const commandsPath = path.join(__dirname, "commands");

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith(".js"));

for (const file of commandFiles) {

  try {

    const command = require(`./commands/${file}`);

    if (!command?.data || !command?.execute) {
      console.log(`Invalid command skipped: ${file}`);
      continue;
    }

    client.commands.set(command.data.name, command);

  } catch (err) {

    console.error(`Failed loading command: ${file}`);
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

  // ===== SLASH COMMANDS =====

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

  // ===== BUTTONS =====

  if (interaction.isButton()) {

    const active = activeCalls.get(interaction.channel.id);

    if (!active) {
      return interaction.reply({
        content: "No active game call found.",
        ephemeral: true
      });
    }

    // ===== CANCEL GAME =====

    if (interaction.customId === "gamecall_cancel") {

      await interaction.deferReply({ ephemeral: true });

      clearTimeout(active.t1);
      clearTimeout(active.t2);

      const msg = await interaction.channel.messages.fetch(active.messageId);

      const lines = msg.content.split("\n");

      const match = lines[0].match(/^GAME\s+(\d+)\s+(\S+)/i);

      const game = match[1];
      const region = match[2];

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

    // ===== OVERRIDE CODE =====

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

  // ===== MODAL SUBMIT =====

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

// ================= WELCOME =================

client.on("guildMemberAdd", handleWelcome);

// ================= LOGIN =================

client.login(process.env.DISCORD_TOKEN);