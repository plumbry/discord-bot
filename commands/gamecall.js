const { SlashCommandBuilder } = require("discord.js");

const RAISE_HAND = "✋";
const ZBD_ERROR_ID = "1428748821160001617";

function generateTimestamp(time, timezone) {

  const [hour, minute] = time.split(":").map(Number);

  const tz =
    timezone === "ET"
      ? "America/New_York"
      : "Europe/London";

  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(now);

  const year = parts.find(p => p.type === "year").value;
  const month = parts.find(p => p.type === "month").value;
  const day = parts.find(p => p.type === "day").value;

  const localDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);

  const utcDate = new Date(
    localDate.toLocaleString("en-US", { timeZone: "UTC" })
  );

  if (utcDate < now) {
    localDate.setDate(localDate.getDate() + 1);
  }

  const finalUTC = new Date(
    localDate.toLocaleString("en-US", { timeZone: "UTC" })
  );

  return Math.floor(finalUTC.getTime() / 1000);
}

async function getNextGameNumber(channel) {

  const messages = await channel.messages.fetch({ limit: 50 });

  let highestGame = 0;

  const regex = /GAME\s+(\d+)/i;

  for (const msg of messages.values()) {

    const match = msg.content.match(regex);

    if (!match) continue;

    const num = parseInt(match[1]);

    if (num > highestGame) highestGame = num;

  }

  return highestGame + 1;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gamecall")
    .setDescription("Post game start reminders")

    .addStringOption(option =>
      option.setName("code")
        .setDescription("Game code")
        .setRequired(true)
    )

    .addStringOption(option =>
      option.setName("region")
        .setDescription("Region (NAC / EU etc)")
        .setRequired(true)
    )

    .addRoleOption(option =>
      option.setName("role")
        .setDescription("Role to ping")
        .setRequired(true)
    )

    .addStringOption(option =>
      option.setName("time")
        .setDescription("Start time (example: 20:07)")
        .setRequired(true)
    )

    .addStringOption(option =>
      option.setName("timezone")
        .setDescription("Timezone of the input time")
        .setRequired(true)
        .addChoices(
          { name: "ET (US East)", value: "ET" },
          { name: "UK", value: "UK" }
        )
    ),

  async execute(interaction) {

    const code = interaction.options.getString("code");
    const region = interaction.options.getString("region");
    const role = interaction.options.getRole("role");
    const time = interaction.options.getString("time");
    const timezone = interaction.options.getString("timezone");

    const channel = interaction.channel;

    const game = await getNextGameNumber(channel);

    const unix = generateTimestamp(time, timezone);
    const discordTime = `<t:${unix}:t>`;

    await interaction.reply({
      content: `Game ${game} call started.`,
      ephemeral: true
    });

    const message1 = await channel.send(
`GAME ${game} ${region} CODE ${code}
GAME ${game} START BY ${discordTime}
WHO IS NOT IN ${role}`
    );

    await message1.react(RAISE_HAND);
    await message1.react(ZBD_ERROR_ID);

    setTimeout(async () => {

      const message2 = await channel.send(
`WHO IS NOT IN ${role}`
      );

      await message2.react(RAISE_HAND);
      await message2.react(ZBD_ERROR_ID);

    }, 120000);

    setTimeout(async () => {

      const message3 = await channel.send(
`WHO IS NOT IN ${role} (game starting in 2 min max)`
      );

      await message3.react(RAISE_HAND);
      await message3.react(ZBD_ERROR_ID);

    }, 240000);

  }
};