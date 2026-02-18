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
          .setDescription("Number of days")
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
