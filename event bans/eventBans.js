const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { google } = require("googleapis");

// ================= CONFIG =================
const SHEET_ID = "YOUR_SHEET_ID";
const EVENT_SHEET = "Event Bans";
const BAN_CHANNEL_ID = "YOUR_BAN_CHANNEL_ID";

// ================= GOOGLE AUTH =================
const credentials = JSON.parse(
  Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64")
    .toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

// ================= COMMAND =================
const eventBanCommand = new SlashCommandBuilder()
  .setName("eventban")
  .setDescription("Event ban management")

  // APPLY
  .addSubcommand(sub =>
    sub
      .setName("apply")
      .setDescription("Apply an event ban")
      .addUserOption(o =>
        o
          .setName("user")
          .setDescription("User to apply the ban to")
          .setRequired(true)
      )
      .addStringOption(o =>
        o
          .setName("type")
          .setDescription("Type of ban")
          .setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addIntegerOption(o =>
        o
          .setName("events")
          .setDescription("Number of events (1–5)")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(5)
      )
  )

  // PROBATION
  .addSubcommand(sub =>
    sub
      .setName("probation")
      .setDescription("Apply a probation ban")
      .addUserOption(o =>
        o
          .setName("user")
          .setDescription("User to put on probation")
          .setRequired(true)
      )
      .addIntegerOption(o =>
        o
          .setName("days")
          .setDescription("Number of probation days")
          .setRequired(true)
          .setMinValue(1)
      )
      .addStringOption(o =>
        o
          .setName("start")
          .setDescription("Start date (YYYY-MM-DD)")
          .setRequired(true)
      )
  )

  // EVENT PASSED
  .addSubcommand(sub =>
    sub
      .setName("eventpassed")
      .setDescription("Reduce remaining bans of a type")
      .addStringOption(o =>
        o
          .setName("type")
          .setDescription("Ban type to reduce")
          .setRequired(true)
          .addChoices(
            { name: "Money", value: "Money" },
            { name: "No Money", value: "No Money" }
          )
      )
      .addIntegerOption(o =>
        o
          .setName("events")
          .setDescription("Number of events passed")
          .setRequired(true)
          .setMinValue(1)
      )
  )

  // REMOVE LAST
  .addSubcommand(sub =>
    sub
      .setName("removelast")
      .setDescription("Remove the most recent ban for a user")
      .addUserOption(o =>
        o
          .setName("user")
          .setDescription("User to remove the last ban from")
          .setRequired(true)
      )
  );

// ================= HANDLER (unchanged below this) =================
// (keep your existing handler logic here)

module.exports = {
  eventBanCommand,
  handleEventBan,
  recentBanCommand,
  handleRecentBan,
  myBanCommand,
  handleMyBan
};
