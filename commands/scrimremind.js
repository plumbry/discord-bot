const {

  SlashCommandBuilder,

  PermissionFlagsBits,

  GuildScheduledEventStatus,

  ChannelType

} = require("discord.js");



const {

  formatTimestamp,

  getScheduleLabel,

  resolveReminderSendTime

} = require("../lib/scrimRemindScheduler");

const { appendScheduledReminder } = require("../lib/scrimEventSheet");



const LFG_CHANNEL_ID = "1371992858084773963";

const SCHEDULE_LOG_CHANNEL_ID = "1471082166535454780";



const REMINDER_TIMEZONE =

  process.env.REMINDER_TIMEZONE || "Europe/London";



const EVENT_CACHE_MS = 60_000;



/** @type {Map<string, { fetchedAt: number, events: import("discord.js").GuildScheduledEvent[] }>} */

const scheduledEventCache = new Map();



const TEAM_MODE_LABELS = {

  solo: "solo",

  duo: "duo",

  trio: "trio",

  squad: "squad"

};



function isSignupChannelName(name) {

  return name.toLowerCase().includes("sign");

}



function toUnix(date) {

  return Math.floor(date.getTime() / 1000);

}



function calendarDayInTimezone(date, timeZone) {

  return new Intl.DateTimeFormat("en-CA", {

    timeZone,

    year: "numeric",

    month: "2-digit",

    day: "2-digit"

  }).format(date);

}



function formatChoiceLabel(event) {

  const when = event.scheduledStartAt

    ? new Intl.DateTimeFormat("en-GB", {

        timeZone: REMINDER_TIMEZONE,

        weekday: "short",

        day: "numeric",

        month: "short",

        hour: "numeric",

        minute: "2-digit"

      }).format(event.scheduledStartAt)

    : "Time TBD";



  return `${event.name} — ${when}`.slice(0, 100);

}



function formatReminderTime(date) {

  if (!date) {

    return "TBD";

  }



  const unix = toUnix(date);

  return `<t:${unix}:F> (<t:${unix}:R>)`;

}



function isToday(date) {

  if (!date) {

    return false;

  }



  const day = calendarDayInTimezone(date, REMINDER_TIMEZONE);

  const today = calendarDayInTimezone(new Date(), REMINDER_TIMEZONE);



  return day === today;

}



function isTomorrow(date) {

  if (!date) {

    return false;

  }



  const day = calendarDayInTimezone(date, REMINDER_TIMEZONE);

  const tomorrowAnchor = new Date();

  tomorrowAnchor.setDate(tomorrowAnchor.getDate() + 1);

  const tomorrow = calendarDayInTimezone(
    tomorrowAnchor,
    REMINDER_TIMEZONE
  );



  return day === tomorrow;

}



function isTodayOrTomorrow(date) {

  return isToday(date) || isTomorrow(date);

}



function isSelectableEvent(event) {

  return (

    event.status !== GuildScheduledEventStatus.Completed &&

    event.status !== GuildScheduledEventStatus.Cancelled

  );

}



async function fetchGuildScheduledEvents(guild, { force = false } = {}) {

  const cached = scheduledEventCache.get(guild.id);



  if (

    !force &&

    cached &&

    Date.now() - cached.fetchedAt < EVENT_CACHE_MS

  ) {

    return cached.events;

  }



  const collection = await guild.scheduledEvents.fetch();

  const events = [...collection.values()];



  scheduledEventCache.set(guild.id, {

    fetchedAt: Date.now(),

    events

  });



  return events;

}



async function resolveScheduledEvent(guild, eventInput) {

  if (!eventInput?.trim()) {

    return null;

  }



  const eventId = eventInput.trim();



  const fromGatewayCache =

    guild.scheduledEvents.cache.get(eventId);



  if (fromGatewayCache) {

    return fromGatewayCache;

  }



  const fromAutocompleteCache =

    scheduledEventCache.get(guild.id)?.events?.find(

      event => event.id === eventId

    );



  if (fromAutocompleteCache) {

    return fromAutocompleteCache;

  }



  try {

    return await guild.scheduledEvents.fetch(eventId, {

      force: true

    });

  } catch (err) {

    console.error(

      "[SCRIMREMIND] fetch scheduled event by id:",

      eventId,

      err?.message || err

    );

  }



  const allEvents = await fetchGuildScheduledEvents(guild, {

    force: true

  });



  const byId = allEvents.find(event => event.id === eventId);



  if (byId) {

    return byId;

  }



  if (!/^\d{17,20}$/.test(eventId)) {

    const query = eventId.toLowerCase();

    const nameMatches = allEvents.filter(event =>

      event.name.toLowerCase().includes(query)

    );



    if (nameMatches.length === 1) {

      return nameMatches[0];

    }

  }



  return null;

}



function getSelectableScheduledEvents(events) {

  const selectable = events

    .filter(isSelectableEvent)

    .sort((a, b) => {

      const aTime = a.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;

      const bTime = b.scheduledStartAt?.getTime() ?? Number.MAX_SAFE_INTEGER;

      return aTime - bTime;

    });



  const todayAndTomorrow = selectable.filter(

    event =>

      event.scheduledStartAt &&

      isTodayOrTomorrow(event.scheduledStartAt)

  );



  if (todayAndTomorrow.length > 0) {

    return todayAndTomorrow;

  }



  const now = Date.now();



  const upcoming = selectable.filter(event =>

    !event.scheduledStartAt ||

    event.scheduledStartAt.getTime() >= now

  );



  return upcoming.length > 0 ? upcoming : selectable;

}



function buildAutocompleteChoices(events, focused) {

  const query = focused.trim().toLowerCase();



  let filtered = events;



  if (query) {

    filtered = events.filter(event =>

      event.name.toLowerCase().includes(query)

    );

  }



  if (filtered.length === 0 && events.length > 0) {

    filtered = events;

  }



  return filtered

    .slice(0, 25)

    .map(event => ({

      name: formatChoiceLabel(event),

      value: event.id

    }));

}



function findSignupChannels(guild, categoryId) {

  const channels = guild.channels.cache.filter(channel => {

    if (categoryId && channel.parentId !== categoryId) {

      return false;

    }



    if (!channel.isTextBased?.()) {

      return false;

    }



    if (!channel.viewable) {

      return false;

    }



    return isSignupChannelName(channel.name);

  });



  return [...channels.values()].sort((a, b) =>

    a.name.localeCompare(b.name)

  );

}



function formatChannelList(channels) {

  return channels.map(channel => `<#${channel.id}>`).join(", ");

}



function resolveTeamSignupChannel(signupChannels) {

  if (signupChannels.length === 0) {

    return {

      error:

        "No signup channel in that category. " +

        "Add one text channel with **sign** in the name."

    };

  }



  if (signupChannels.length === 1) {

    return { channel: signupChannels[0] };

  }



  return {

    error:

      `Expected **one** signup channel for team modes, found ${signupChannels.length}: ` +

      `${formatChannelList(signupChannels)}. ` +

      "Use a category with only the correct sign channel."

  };

}



function resolveSoloSignupChannels(signupChannels) {

  if (signupChannels.length < 2) {

    return {

      error:

        signupChannels.length === 0

          ? "No signup channels in that category. " +

            "Need two text channels with **sign** in the name."

          : `Expected **two** signup channels for solos, found one: ${formatChannelList(signupChannels)}.`

    };

  }



  if (signupChannels.length === 2) {

    return {

      girl: signupChannels[0],

      boy: signupChannels[1]

    };

  }



  return {

    error:

      `Expected **two** signup channels for solos, found ${signupChannels.length}: ` +

      `${formatChannelList(signupChannels)}. ` +

      "Use a category with only the girls and boys sign channels."

  };

}



function buildTeamReminderMessage({

  eventName,

  eventTime,

  teamMode,

  signupChannelsText,

  pingEveryone

}) {

  const modeLabel = TEAM_MODE_LABELS[teamMode] || teamMode;



  const lines = [

    "## Scrim Reminder!",

    `Hey ZBDers! Sign up for **${eventName}** on ${eventTime} as a **${modeLabel}** in ${signupChannelsText}!`,

    "",

    `Don't have a teammate? Look for one in <#${LFG_CHANNEL_ID}>!`,

    "",

    "-# Want to check Tier Restrictions? [Click Here](https://coedzbd.onhercules.app/tier-restrictions)"

  ];



  if (pingEveryone) {

    lines.push("", "@everyone");

  }



  return lines.join("\n");

}



function buildSoloReminderMessage({

  eventName,

  eventTime,

  girlChannel,

  boyChannel,

  pingEveryone

}) {

  const lines = [

    "## Scrim Reminder!",

    `Hey ZBDers! Sign up for **${eventName}** on ${eventTime} as a **solo**!`,

    "",

    `Girls: <#${girlChannel.id}>`,

    `Boys: <#${boyChannel.id}>`

  ];



  if (pingEveryone) {

    lines.push("", "@everyone");

  }



  return lines.join("\n");

}



function buildScheduleLogMessage({

  moderator,

  scheduledEvent,

  mode,

  category,

  targetChannel,

  confirmSignupLines,

  sendAt,

  scheduleLabel,

  pingEveryone,

  postedEarly

}) {

  const lines = [

    "## Message scheduled",

    `**Moderator:** ${moderator}`,

    `**Event:** ${scheduledEvent.name}`,

    `**Event starts:** ${formatReminderTime(scheduledEvent.scheduledStartAt)}`,

    `**Schedule:** ${scheduleLabel}`,

    `**Posts at:** ${formatTimestamp(new Date(sendAt))}`,

    `**Post in:** ${targetChannel}`,

    `**Category:** ${category}`,

    `**Mode:** ${TEAM_MODE_LABELS[mode] || mode}`,

    confirmSignupLines,

    `**Ping @everyone:** ${pingEveryone ? "Yes" : "No"}`

  ];



  if (postedEarly) {

    lines.push(

      "",

      "_Planned time was already in the past — reminder will post immediately instead._"

    );

  }



  return lines.join("\n");

}



async function postScheduleLog(client, logContent) {

  try {

    const logChannel = await client.channels.fetch(

      SCHEDULE_LOG_CHANNEL_ID

    );



    if (!logChannel?.isTextBased?.()) {

      console.error(

        "[SCRIMREMIND] Schedule log channel not sendable:",

        SCHEDULE_LOG_CHANNEL_ID

      );

      return;

    }



    await logChannel.send({ content: logContent });

  } catch (err) {

    console.error("[SCRIMREMIND] Failed to post schedule log:", err);

  }

}



module.exports = {

  data: new SlashCommandBuilder()

    .setName("scrimremind")

    .setDescription(

      "Post a scrim signup reminder from a server scheduled event"

    )

    .addStringOption(option =>

      option

        .setName("event")

        .setDescription("Scheduled event from the Events tab")

        .setRequired(true)

        .setAutocomplete(true)

    )

    .addStringOption(option =>

      option

        .setName("mode")

        .setDescription("Duos, trios, squads, or solos")

        .setRequired(true)

        .addChoices(

          { name: "Solos", value: "solo" },

          { name: "Duos", value: "duo" },

          { name: "Trios", value: "trio" },

          { name: "Squads", value: "squad" }

        )

    )

    .addChannelOption(option =>

      option

        .setName("category")

        .setDescription(

          "Event category — finds sign channel(s) automatically"

        )

        .addChannelTypes(ChannelType.GuildCategory)

        .setRequired(true)

    )

    .addStringOption(option =>

      option

        .setName("schedule")

        .setDescription(
          "Optional — leave empty to post immediately"
        )

        .setRequired(false)

        .addChoices(

          { name: "1 hour before event", value: "60" },

          { name: "2 hours before event", value: "120" },

          { name: "3 hours before event", value: "180" },

          { name: "4 hours before event", value: "240" },

          { name: "6 hours before event", value: "360" },

          { name: "12 hours before event", value: "720" },

          { name: "24 hours before event", value: "1440" }

        )

    )

    .addBooleanOption(option =>

      option

        .setName("ping_everyone")

        .setDescription("Tag @everyone on the reminder")

        .setRequired(false)

    )

    .setDefaultMemberPermissions(

      PermissionFlagsBits.ManageRoles

    ),



  async autocomplete(interaction) {

    const focused = interaction.options.getFocused();



    try {

      const allEvents =

        await fetchGuildScheduledEvents(interaction.guild);



      const selectable =

        getSelectableScheduledEvents(allEvents);



      const choices =

        buildAutocompleteChoices(selectable, focused);



      return await interaction.respond(choices);

    } catch (err) {

      console.error("[SCRIMREMIND AUTOCOMPLETE]", err);



      if (interaction.responded) {

        return;

      }



      return interaction.respond([]).catch(() => {});

    }

  },



  async execute(interaction) {

    await interaction.deferReply({ ephemeral: true });



    const guild = interaction.guild;

    const eventId = interaction.options.getString("event");

    const mode = interaction.options.getString("mode");

    const category = interaction.options.getChannel("category");

    const scheduleValue =

      interaction.options.getString("schedule") || "now";

    const targetChannel = interaction.channel;

    const pingEveryone =

      interaction.options.getBoolean("ping_everyone") || false;



    if (!targetChannel?.isTextBased?.()) {

      return interaction.editReply({

        content: "The reminder channel must be a text channel."

      });

    }



    const scheduledEvent = await resolveScheduledEvent(guild, eventId);



    if (!scheduledEvent) {

      return interaction.editReply({

        content:

          "Could not find that scheduled event.\n\n" +

          "• Choose **event** from the dropdown (don't type the name)\n" +

          "• The event must still exist on the server **Events** tab\n" +

          "• Re-invite the bot with **applications.commands** if this keeps happening"

      });

    }



    scheduledEventCache.set(guild.id, {

      fetchedAt: Date.now(),

      events: [

        scheduledEvent,

        ...(

          scheduledEventCache.get(guild.id)?.events || []

        ).filter(event => event.id !== scheduledEvent.id)

      ]

    });



    if (category?.type !== ChannelType.GuildCategory) {

      return interaction.editReply({

        content: "Pick a **category**, not a text or voice channel."

      });

    }



    const sendPlan = resolveReminderSendTime(

      scheduledEvent.scheduledStartAt,

      scheduleValue

    );



    if (sendPlan.error) {

      return interaction.editReply({ content: sendPlan.error });

    }



    if (!guild.channels.cache.size) {

      await guild.channels.fetch();

    }



    const signupChannels = findSignupChannels(guild, category.id);

    const eventTime = formatReminderTime(scheduledEvent.scheduledStartAt);



    let content;

    let confirmSignupLines;



    if (mode === "solo") {

      const soloResolved = resolveSoloSignupChannels(signupChannels);



      if (soloResolved.error) {

        return interaction.editReply({ content: soloResolved.error });

      }



      content = buildSoloReminderMessage({

        eventName: scheduledEvent.name,

        eventTime,

        girlChannel: soloResolved.girl,

        boyChannel: soloResolved.boy,

        pingEveryone

      });



      confirmSignupLines =

        `**Signups:**\nGirls: ${soloResolved.girl}\nBoys: ${soloResolved.boy}`;

    } else {

      const resolved = resolveTeamSignupChannel(signupChannels);



      if (resolved.error) {

        return interaction.editReply({ content: resolved.error });

      }



      const signupChannel = resolved.channel;



      content = buildTeamReminderMessage({

        eventName: scheduledEvent.name,

        eventTime,

        teamMode: mode,

        signupChannelsText: `<#${signupChannel.id}>`,

        pingEveryone

      });



      confirmSignupLines = `**Signups:** ${signupChannel}`;

    }



    const allowedMentions = pingEveryone

      ? { parse: ["everyone"] }

      : { parse: [] };



    const scheduleLabel = getScheduleLabel(scheduleValue);

    const sendAt = sendPlan.sendAt;



    if (sendPlan.isScheduled) {

      if (!process.env.MAIN_SHEET_ID) {
        return interaction.editReply({
          content:
            "MAIN_SHEET_ID is not configured — cannot save scheduled reminders."
        });
      }

      try {
        await appendScheduledReminder({
          sendAt,
          channelId: targetChannel.id,
          guildId: guild.id,
          content,
          pingEveryone,
          moderatorId: interaction.user.id,
          eventName: scheduledEvent.name,
          mode,
          scheduleLabel
        });
      } catch (err) {
        console.error("[SCRIMREMIND] sheet append failed:", err);

        return interaction.editReply({
          content:
            "Failed to save the scheduled reminder to the **Scrim Events** sheet. " +
            "Check the tab exists and the bot has sheet access."
        });
      }

      await postScheduleLog(

        interaction.client,

        buildScheduleLogMessage({

          moderator: interaction.user,

          scheduledEvent,

          mode,

          category,

          targetChannel,

          confirmSignupLines,

          sendAt,

          scheduleLabel,

          pingEveryone,

          postedEarly: false

        })

      );



      return interaction.editReply({

        content:

          `Reminder scheduled for ${formatTimestamp(new Date(sendAt))} in ${targetChannel}.\n` +

          `${confirmSignupLines.replace(/\*\*/g, "")}\n\n` +

          `Saved to the **Scrim Events** sheet (survives bot restarts).\n` +

          `A confirmation was posted in <#${SCHEDULE_LOG_CHANNEL_ID}>.`

      });

    }



    try {

      const message = await targetChannel.send({

        content,

        allowedMentions

      });



      let reply =

        `Reminder posted in ${targetChannel}.\n` +

        `${confirmSignupLines.replace(/\*\*/g, "")}\n` +

        `Message: ${message.url}`;



      if (sendPlan.postedEarly) {

        reply +=

          "\n\n_That schedule time had already passed — posted immediately._";

      }



      return interaction.editReply({ content: reply });

    } catch (err) {

      console.error("[SCRIMREMIND]", err);



      return interaction.editReply({

        content:

          "Failed to send the reminder. Check bot permissions in that channel" +

          (pingEveryone ? " and whether @everyone is allowed." : ".")

      });

    }

  }

};

