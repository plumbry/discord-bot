const { SlashCommandBuilder } = require("discord.js");

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

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(now);

  const year = parts.find(p => p.type === "year").value;
  const month = parts.find(p => p.type === "month").value;
  const day = parts.find(p => p.type === "day").value;

  const iso = `${year}-${month}-${day}T${hour
    .toString()
    .padStart(2, "0")}:${minute
    .toString()
    .padStart(2, "0")}:00`;

  const local = new Date(iso);

  const utc = new Date(local.toLocaleString("en-US", { timeZone: "UTC" }));

  if (utc < now) {
    local.setDate(local.getDate() + 1);
  }

  const finalUTC = new Date(local.toLocaleString("en-US", { timeZone: "UTC" }));

  return Math.floor(finalUTC.getTime() / 1000);
}

async function getNextGameNumber(channel) {

  const messages = await channel.messages.fetch({ limit: 50 });

  let highest = 0;

  const regex = /GAME\s+(\d+)/i;

  for (const msg of messages.values()) {

    const match = msg.content.match(regex);

    if (!match) continue;

    const num = parseInt(match[1]);

    if (num > highest) highest = num;

  }

  return highest + 1;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("gamecall")
    .setDescription("Manage game calls")

    .addStringOption(option =>
      option.setName("code")
        .setDescription("Game code")
    )

    .addStringOption(option =>
      option.setName("region")
        .setDescription("Region (NAC / EU etc)")
    )

    .addRoleOption(option =>
      option.setName("role")
        .setDescription("Role to ping")
    )

    .addStringOption(option =>
      option.setName("time")
        .setDescription("Start time HH:MM (example 20:07)")
    )

    .addStringOption(option =>
      option.setName("timezone")
        .setDescription("Timezone of the input time")
        .addChoices(
          { name: "ET (US East)", value: "ET" },
          { name: "UK", value: "UK" }
        )
    )

    .addStringOption(option =>
      option.setName("override")
        .setDescription("Override existing game code")
    )

    .addBooleanOption(option =>
      option.setName("cancel")
        .setDescription("Cancel current game call")
    ),

  async execute(interaction) {

    const channel = interaction.channel;

    const override = interaction.options.getString("override");
    const cancel = interaction.options.getBoolean("cancel");

    const active = activeCalls.get(channel.id);

    // CANCEL CURRENT CALL
    if (cancel) {

      if (active) {
        clearTimeout(active.t1);
        clearTimeout(active.t2);
        activeCalls.delete(channel.id);
      }

      return interaction.reply({
        content: "Game call cancelled.",
        ephemeral: true
      });
    }

    // OVERRIDE CODE
    if (override) {

      const messages = await channel.messages.fetch({ limit: 20 });

      const target = messages.find(m => /^GAME\s+\d+/i.test(m.content));

      if (!target) {
        return interaction.reply({
          content: "No active GAME message found.",
          ephemeral: true
        });
      }

      const lines = target.content.split("\n");

      const match = lines[0].match(/^GAME\s+(\d+)\s+(\S+)/i);

      const game = match[1];
      const region = match[2];

      lines[0] = `GAME ${game} ${region} CODE ${override}`;

      await target.edit(lines.join("\n"));

      if (active) {
        clearTimeout(active.t1);
        clearTimeout(active.t2);
        activeCalls.delete(channel.id);
      }

      return interaction.reply({
        content: `Game code updated to **${override}**.`,
        ephemeral: true
      });
    }

    // NORMAL GAME CALL
    const code = interaction.options.getString("code");
    const region = interaction.options.getString("region");
    const role = interaction.options.getRole("role");
    const time = interaction.options.getString("time");
    const timezone = interaction.options.getString("timezone");

    if (!code || !region || !role || !time || !timezone) {
      return interaction.reply({
        content: "Missing fields to start a game call.",
        ephemeral: true
      });
    }

    const game = await getNextGameNumber(channel);

    const unix = generateTimestamp(time, timezone);

    if (!unix) {
      return interaction.reply({
        content: "Invalid time format. Use HH:MM (example 20:07).",
        ephemeral: true
      });
    }

    const discordTime = `<t:${unix}:t>`;

    await interaction.reply({
      content: `Game ${game} call started.`,
      ephemeral: true
    });

    const msg1 = await channel.send(
`GAME ${game} ${region} CODE ${code}
GAME ${game} START BY ${discordTime}
WHO IS NOT IN ${role}`
    );

    await msg1.react(RAISE_HAND);
    await msg1.react(ZBD_ERROR_ID);

    const t1 = setTimeout(async () => {

      const msg2 = await channel.send(
`WHO IS NOT IN ${role}`
      );

      await msg2.react(RAISE_HAND);
      await msg2.react(ZBD_ERROR_ID);

    }, 120000);

    const t2 = setTimeout(async () => {

      const msg3 = await channel.send(
`WHO IS NOT IN ${role} (game starting in 2 min max)`
      );

      await msg3.react(RAISE_HAND);
      await msg3.react(ZBD_ERROR_ID);

      activeCalls.delete(channel.id);

    }, 240000);

    activeCalls.set(channel.id, { t1, t2 });

  }
};