const { SlashCommandBuilder } = require("discord.js");

const RAISE_HAND = "✋";
const ZBD_ERROR_ID = "1428748821160001617";

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
      option.setName("endtime")
        .setDescription("Game start time (example: 20:07)")
        .setRequired(true)
    ),

  async execute(interaction) {

    const game = interaction.options.getInteger("game");
    const code = interaction.options.getString("code");
    const region = interaction.options.getString("region");
    const role = interaction.options.getRole("role");
    const endtime = interaction.options.getString("endtime");

    const channel = interaction.channel;

    await interaction.reply({
      content: "Game call started.",
      ephemeral: true
    });

    // MESSAGE 1
    const message1 = await channel.send(
`GAME ${game} ${region} CODE ${code}
GAME ${game} START BY ${endtime}
WHO IS NOT IN ${role}`
    );

    await message1.react(RAISE_HAND);
    await message1.react(ZBD_ERROR_ID);

    // MESSAGE 2 (after 2 minutes)
    setTimeout(async () => {

      const message2 = await channel.send(
`WHO IS NOT IN ${role}`
      );

      await message2.react(RAISE_HAND);
      await message2.react(ZBD_ERROR_ID);

    }, 120000);

    // MESSAGE 3 (after 4 minutes)
    setTimeout(async () => {

      const message3 = await channel.send(
`WHO IS NOT IN ${role} (game starting in 2 min max)`
      );

      await message3.react(RAISE_HAND);
      await message3.react(ZBD_ERROR_ID);

    }, 240000);

  }
};