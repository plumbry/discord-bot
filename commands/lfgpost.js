/**
 * Decommissioned: public LFG now lives under `/lfg post|resend|end|unregister`.
 * Kept so existing `lfgpost:` message components still resolve if this module
 * is loaded; handlers are owned by `commands/lfg.js` via `lib/lfgPostCommand.js`.
 */
const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  decommissioned: true,
  data: new SlashCommandBuilder()
    .setName("lfgpost")
    .setDescription("Deprecated — use /lfg post"),

  async execute(interaction) {
    return interaction.reply({
      content:
        "`/lfgpost` has been replaced by `/lfg post`. Use `/lfg resend`, `/lfg end`, and `/lfg unregister` for the rest.",
      ephemeral: true
    });
  }
};
