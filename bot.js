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

// ================= BAN EXPIRY CHECKER =================

const { startBanExpiryChecker } = require("./banExpiryChecker");

// ================= DM SYSTEM =================

const dm = require("./commands/dm");

// ================= GAMECALL STATE =================

const gamecallModule = require("./commands/gamecall");
const activeCalls = gamecallModule.activeCalls;

// ================= CONSTANTS =================

const GUILD_ID = "1371615693392576580";

// ================= CREATE CLIENT =================

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

    if (!command.data || !command.execute) {
      console.log(`⚠️ Command missing data or execute: ${file}`);
      continue;
    }

    client.commands.set(command.data.name, command);

  } catch (err) {

    console.error(`❌ Failed to load command: ${file}`);
    console.error(err);

  }

}

// ================= READY =================

client.once("ready", async () => {

  console.log(`🤖 Logged in as ${client.user.tag}`);

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

  const commandJSON = commands.map(c => c.toJSON());

  try {

    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commandJSON }
    );

    console.log("✅ Slash commands registered");

  } catch (err) {

    console.error("❌ Failed to update commands");
    console.error(err);

  }

  if (dm.startDMScheduler) {
    dm.startDMScheduler(client);
  }

});

// ================= DM BLOCK =================

client.on("messageCreate", async message => {

  if (message.author.bot) return;

  if (!message.guild) {

    try {

      await message.reply(
        "❌ This bot does not accept direct messages."
      );

    } catch (err) {

      console.error("Failed to reply to DM:", err);

    }

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

      console.error(`Command error (${interaction.commandName}):`, error);

      if (interaction.replied || interaction.deferred) {

        await interaction.followUp({
          content: "There was an error executing this command.",
          ephemeral: true
        });

      } else {

        await interaction.reply({
          content: "There was an error executing this command.",
          ephemeral: true
        });

      }

    }

  }

  // ===== GAMECALL BUTTONS =====

  if (interaction.isButton()) {

    const active = activeCalls.get(interaction.channel.id);
    if (!active) return;

    if (interaction.customId === "gamecall_cancel") {

      clearTimeout(active.t1);
      clearTimeout(active.t2);

      activeCalls.delete(interaction.channel.id);

      return interaction.reply({
        content: "Game call cancelled.",
        ephemeral: true
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

      const roleMatch = msg.content.match(/<@&\d+>/);
      const rolePing = roleMatch ? roleMatch[0] : "";

      await interaction.channel.send(
`🚨 **NEW CODE** ${rolePing}
CODE ${newCode}`
      );

      clearTimeout(active.t1);
      clearTimeout(active.t2);

      activeCalls.delete(interaction.channel.id);

      return interaction.reply({
        content: `Game code updated to **${newCode}**.`,
        ephemeral: true
      });

    }

  }

  // ===== DM BUTTON HANDLER =====

  if (interaction.isButton() && dm.handleDMButton) {
    return dm.handleDMButton(interaction);
  }

});

// ================= WELCOME =================

client.on("guildMemberAdd", handleWelcome);

// ================= LOGIN =================

client.login(process.env.DISCORD_TOKEN)
  .catch(err => {
    console.error("❌ Discord login failed:", err);
  });