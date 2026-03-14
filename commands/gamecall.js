const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const RAISE_HAND = "✋";
const ZBD_ERROR_ID = "1428748821160001617";

const BOT_LOG_CHANNEL = "1471082166535454780";

const activeCalls = new Map();

async function getNextGameNumber(channel){

  const messages = await channel.messages.fetch({limit:50});

  let highest = 0;

  const regex = /GAME\s+(\d+)/i;

  for(const msg of messages.values()){

    const match = msg.content.match(regex);
    if(!match) continue;

    const num = parseInt(match[1]);

    if(num > highest) highest = num;

  }

  return highest + 1;
}

module.exports = {

  data: new SlashCommandBuilder()
    .setName("gamecall")
    .setDescription("Start a game call")

    .addStringOption(o =>
      o.setName("code")
        .setDescription("Game code")
        .setRequired(true))

    .addStringOption(o =>
      o.setName("region")
        .setDescription("Game region")
        .setRequired(true)
        .addChoices(
          { name: "NAC", value: "NAC" },
          { name: "EU", value: "EU" }
        ))

    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to ping")
        .setRequired(true))

    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Start game in X minutes")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(60)),

  async execute(interaction){

    const code = interaction.options.getString("code");
    const region = interaction.options.getString("region");
    const role = interaction.options.getRole("role");
    const minutes = interaction.options.getInteger("minutes");

    const channel = interaction.channel;
    const guild = interaction.guild;

    const game = await getNextGameNumber(channel);

    const start = Date.now() + minutes * 60000;
    const unix = Math.floor(start / 1000);

    const relative = `<t:${unix}:R>`;
    const exact = `<t:${unix}:t>`;

    const controls = new ActionRowBuilder().addComponents(

      new ButtonBuilder()
        .setCustomId("gamecall_override")
        .setLabel("Override Code")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("gamecall_stop_followups")
        .setLabel("Stop Follow Ups")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("gamecall_cancel")
        .setLabel("Cancel Game Call")
        .setStyle(ButtonStyle.Danger)

    );

    await interaction.reply({
      content:`Game ${game} call started.`,
      ephemeral:true,
      components:[controls]
    });

    const msg = await channel.send(
`GAME ${game} ${region} CODE ${code}
GAME ${game} START ${relative} (${exact})
WHO IS NOT IN ${role}`
    );

    await msg.react(RAISE_HAND);
    await msg.react(ZBD_ERROR_ID);

    const t1 = setTimeout(async ()=>{

      const m = await channel.send(`WHO IS NOT IN ${role}`);

      await m.react(RAISE_HAND);
      await m.react(ZBD_ERROR_ID);

    },120000);

    const t2 = setTimeout(async ()=>{

      const m = await channel.send(
`WHO IS NOT IN ${role} (game starting in 2 min max)`
      );

      await m.react(RAISE_HAND);
      await m.react(ZBD_ERROR_ID);

      activeCalls.delete(channel.id);

    },240000);

    activeCalls.set(channel.id,{
      messageId: msg.id,
      roleId: role.id,
      gameNumber: game,
      t1,
      t2,
      status: "Active",
      chat: "Open",
      streams: "Unchecked",
      followups: "Running",
      panelMessageId: null
    });

    const staffControls = new ActionRowBuilder().addComponents(

      new ButtonBuilder()
        .setCustomId(`staff_cancel_game_${channel.id}`)
        .setLabel("Cancel Game")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId(`staff_stop_followups_${channel.id}`)
        .setLabel("Stop Followups")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(`staff_lock_chat_${channel.id}`)
        .setLabel("Lock Chat")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId(`staff_unlock_chat_${channel.id}`)
        .setLabel("Unlock Chat")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`staff_check_streams_${channel.id}`)
        .setLabel("Check Streams")
        .setStyle(ButtonStyle.Primary)

    );

    const logChannel = guild.channels.cache.get(BOT_LOG_CHANNEL);

    if(!logChannel){
      console.error("Bot log channel not found.");
      return;
    }

    const panel = await logChannel.send({
      content:
`🎮 GAME ${game} CONTROL PANEL

Status: Active
Chat: Open
Streams: Unchecked
Followups: Running`,
      components:[staffControls]
    });

    const call = activeCalls.get(channel.id);
    if(call){
      call.panelMessageId = panel.id;
    }

  }

};

module.exports.activeCalls = activeCalls;