const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} = require("discord.js");

module.exports = {

  data: new SlashCommandBuilder()
    .setName("reword")
    .setDescription("Replace a word in a category name and all channels inside it")

    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)

    .addChannelOption(option =>
      option
        .setName("category")
        .setDescription("Category to modify")
        .setRequired(true))

    .addStringOption(option =>
      option
        .setName("find")
        .setDescription("Word to replace")
        .setRequired(true))

    .addStringOption(option =>
      option
        .setName("replace")
        .setDescription("Replacement word")
        .setRequired(true)),

  async execute(interaction) {

    const category = interaction.options.getChannel("category");
    const find = interaction.options.getString("find");
    const replace = interaction.options.getString("replace");

    if (category.type !== ChannelType.GuildCategory) {
      return interaction.reply({
        content: "❌ That channel is not a category.",
        ephemeral: true
      });
    }

    await interaction.reply("Updating names...");

    const regex = new RegExp(find, "gi");

    let changed = 0;

    // Rename category
    const newCategoryName = category.name.replace(regex, replace);

    if (newCategoryName !== category.name) {
      await category.setName(newCategoryName);
      changed++;
    }

    // Rename channels inside category
    const channels = category.children.cache;

    for (const channel of channels.values()) {

      const newName = channel.name.replace(regex, replace);

      if (newName !== channel.name) {

        await channel.setName(newName);
        changed++;

        // avoid Discord rate limits
        await new Promise(r => setTimeout(r, 500));
      }
    }

    await interaction.followUp(
      `✅ Updated ${changed} names (category + channels).`
    );

  }

};