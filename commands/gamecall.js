const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const RAISE_HAND = "✋";
const ZBD_ERROR_ID = "1428748821160001617";

const activeCalls = new Map();

function generateTimestamp(time, timezone) {

  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hour = parseInt(match[1]);
  const minute = parseInt(match[2]);

  const tz =
    timezone === "ET"
      ? "America/New_York"
      : "Europe/London";

  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const year = parts.find(p => p.type === "year").value;
  const month = parts.find(p => p.type === "month").value;
  const day = parts.find(p => p.type === "day").value;

  const iso = `${year}-${month}-${day}T${hour
    .toString()
    .padStart(2,"0")}:${minute
    .toString()
    .padStart(2,"0")}:00`;

  const local = new Date(
    new Date(iso).toLocaleString("en-US",{timeZone:tz})
  );

  const utc = new Date(local.toLocaleString("en-US",{timeZone:"UTC"}));

  if (utc < now) local.setDate(local.getDate()+1);

  const finalUTC = new Date(
    local.toLocaleString("en-US",{timeZone:"UTC"})
  );

  return Math.floor(finalUTC.getTime()/1000);
}

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
        .setDescription("Region (NAC/EU)")
        .setRequired(true))

    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to ping")
        .setRequired(true))

    .addStringOption(o =>
      o.setName("time")
        .setDescription("Start time HH:MM")
        .setRequired(true))

    .addStringOption(o =>
      o.setName("timezone")
        .setDescription("Timezone")
        .setRequired(true)
        .addChoices(
          {name:"ET",value:"ET"},
          {name:"UK",value:"UK"}
        )),

  async execute(interaction){

    const code = interaction.options.getString("code");
    const region = interaction.options.getString("region");
    const role = interaction.options.getRole("role");
    const time = interaction.options.getString("time");
    const timezone = interaction.options.getString("timezone");

    const channel = interaction.channel;

    const game = await getNextGameNumber(channel);

    const unix = generateTimestamp(time, timezone);

    if(!unix){
      return interaction.reply({
        content:"Invalid time format. Use HH:MM.",
        ephemeral:true
      });
    }

    const discordTime = `<t:${unix}:t>`;

    await interaction.reply({
      content:`Game ${game} call started.`,
      ephemeral:true
    });

    const msg = await channel.send(
`GAME ${game} ${region} CODE ${code}
GAME ${game} START BY ${discordTime}
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
      messageId:msg.id,
      t1,
      t2
    });

    const controls = new ActionRowBuilder().addComponents(

      new ButtonBuilder()
        .setCustomId("gamecall_override")
        .setLabel("Override Code")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("gamecall_cancel")
        .setLabel("Cancel Game Call")
        .setStyle(ButtonStyle.Danger)

    );

    await interaction.followUp({
      content:`Game ${game} controls`,
      ephemeral:true,
      components:[controls]
    });

  }

};

module.exports.activeCalls = activeCalls;