const { SlashCommandBuilder } = require("discord.js");

const RAISE_HAND = "✋";
const ZBD_ERROR_ID = "1428748821160001617";

function generateTimestamp(time, timezone) {

  const [hour, minute] = time.split(":").map(Number);

  const now = new Date();

  const date = new Date();

  date.setUTCHours(hour, minute, 0, 0);

  if (timezone === "EST") {
    date.setUTCHours(hour + 5, minute, 0, 0);
  }

  if (timezone === "GMT") {
    date.setUTCHours(hour, minute, 0, 0);
  }

  if (date < now) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return Math.floor(date.getTime() / 1000);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gamecall")
    .setDescription("Post game start reminders")

    .addIntegerOption(option =>
      option.setName("game")
        .setDescription("Game number")
        .setRequired(true)
    )

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
        .setDescription("Timezone of the entered time")
        .setRequired(true)
        .addChoices(
          { name: "EST", value: "EST" },
          { name: "GMT", value: "GMT" }
        )
    ),

  async execute(interaction) {

    const game = interaction.options.getInteger("game");
    const code = interaction.options.getString("code");
    const region = interaction.options.getString("region");
    const role = interaction.options.getRole("role");
    const time = interaction.options.getString("time");
    const timezone = interaction.options.getString("timezone");

    const channel = interaction.channel;

    const unix = generateTimestamp(time, timezone);
    const discordTime = `<t:${unix}:t>`;

    await interaction.reply({
      content: "Game call started.",
      ephemeral: true
    });

    const message1 = await channel.send(
`GAME ${game} ${region} ${code}
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