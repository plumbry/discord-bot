const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder
} = require("discord.js");

const { formatRulesEventTime } = require("./guildScheduledEvents");

const POST_CUSTOM = {
  STAFF_EVENT: "lfgpost:staff:event",
  STAFF_MODE: "lfgpost:staff:mode",
  STAFF_ROLE: "lfgpost:staff:role",
  STAFF_EVERYONE: "lfgpost:staff:everyone",
  FILL_PREFIX: "lfgpost:fill:",
  NEED_PREFIX: "lfgpost:need:",
  FILL_STOP_PREFIX: "lfgpost:fillstop:",
  NEED_STOP_PREFIX: "lfgpost:needstop:",
  NEED_TIERS_PREFIX: "lfgpost:needtiers:",
  NEED_GENDER_PREFIX: "lfgpost:needgen:",
  NEED_SUBMIT_PREFIX: "lfgpost:needgo:"
};

const TIER_OPTIONS = ["S", "A", "B", "C"];

const GENDER_OPTIONS = [
  { value: "girl", label: "Girl" },
  { value: "boy", label: "Boy" }
];

const POST_GENDER_LABEL = {
  girl: "Girl",
  boy: "Boy"
};

function isLfgPostCustomId(customId) {
  return typeof customId === "string" && customId.startsWith("lfgpost:");
}

function discordTimestamp(date) {
  if (!date) {
    return "TBD";
  }

  const value = date instanceof Date ? date : new Date(date);

  if (Number.isNaN(value.getTime())) {
    return "TBD";
  }

  return formatRulesEventTime(value);
}

function publicPostContent(eventName, startAt, { mentionEveryone = false } = {}) {
  const lines = [];

  if (mentionEveryone) {
    lines.push("@everyone", "");
  }

  lines.push(
    `**Looking to play ${eventName} at ${discordTimestamp(startAt)}?**`,
    "",
    "Click below to register your interest, or be DMed when someone who fits your team becomes available!"
  );

  return lines.join("\n");
}

function publicPostRows(eventId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${POST_CUSTOM.FILL_PREFIX}${eventId}`)
        .setLabel("Looking to join / fill")
        .setEmoji("🟢")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${POST_CUSTOM.NEED_PREFIX}${eventId}`)
        .setLabel("I / We need a teammate")
        .setEmoji("🔎")
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function staffEventSelectRow(events) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(POST_CUSTOM.STAFF_EVENT)
      .setPlaceholder("Choose a Discord Scheduled Event")
      .addOptions(
        events.slice(0, 25).map(event => ({
          label: event.name.slice(0, 100),
          value: event.id,
          description: event.whenLabel
            ? String(event.whenLabel).slice(0, 100)
            : "Upcoming"
        }))
      )
  );
}

function staffModeSelectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(POST_CUSTOM.STAFF_MODE)
      .setPlaceholder("Choose Duos / Trios / Squads")
      .addOptions(
        [
          { label: "Duos", value: "duos" },
          { label: "Trios", value: "trios" },
          { label: "Squads", value: "squads" }
        ]
      )
  );
}

function staffRoleSelectRow() {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(POST_CUSTOM.STAFF_ROLE)
      .setPlaceholder("Choose the event signup role")
      .setMinValues(1)
      .setMaxValues(1)
  );
}

function staffEveryoneSelectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(POST_CUSTOM.STAFF_EVERYONE)
      .setPlaceholder("Tag @everyone?")
      .addOptions([
        { label: "True", value: "true", description: "Ping @everyone on the LFG post" },
        { label: "False", value: "false", description: "Do not ping @everyone" }
      ])
  );
}

function fillManageRows(requestId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${POST_CUSTOM.FILL_STOP_PREFIX}${requestId}`)
        .setLabel("No Longer Available")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function needManageRows(requestId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${POST_CUSTOM.NEED_STOP_PREFIX}${requestId}`)
        .setLabel("Found Teammate / Stop Looking")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function needNotifyStopRows(requestId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${POST_CUSTOM.NEED_STOP_PREFIX}${requestId}`)
        .setLabel("Stop Notifying")
        .setStyle(ButtonStyle.Danger)
    )
  ];
}

function needFlowRows(eventId, selectedTiers = [], selectedGenders = []) {
  const genders = Array.isArray(selectedGenders)
    ? selectedGenders
    : selectedGenders
      ? [selectedGenders]
      : [];

  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${POST_CUSTOM.NEED_TIERS_PREFIX}${eventId}`)
        .setPlaceholder("Required tier(s)")
        .setMinValues(1)
        .setMaxValues(TIER_OPTIONS.length)
        .addOptions(
          TIER_OPTIONS.map(tier => ({
            label: `${tier} Tier`,
            value: tier,
            default: selectedTiers.includes(tier)
          }))
        )
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${POST_CUSTOM.NEED_GENDER_PREFIX}${eventId}`)
        .setPlaceholder("Required gender(s)")
        .setMinValues(1)
        .setMaxValues(GENDER_OPTIONS.length)
        .addOptions(
          GENDER_OPTIONS.map(option => ({
            label: option.label,
            value: option.value,
            default: genders.includes(option.value)
          }))
        )
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${POST_CUSTOM.NEED_SUBMIT_PREFIX}${eventId}`)
        .setLabel("Submit")
        .setStyle(ButtonStyle.Success)
    )
  ];
}

function fillMatchDm({ tier, gender, fillUserId }) {
  const genderLabel = POST_GENDER_LABEL[gender] || gender;

  return [
    `**${tier} Tier ${genderLabel} <@${fillUserId}> is looking to fill!**`,
    "",
    "Please DM them or tag them in Looking for Group!"
  ].join("\n");
}

function formatNeedSummary(acceptedTiers, requiredGender) {
  const tiers = (acceptedTiers || []).join("/");
  const genderKey = String(requiredGender || "").toLowerCase();
  const gender =
    genderKey === "either"
      ? "Girl/Boy"
      : POST_GENDER_LABEL[genderKey] || requiredGender;

  return `${tiers} · ${gender}`;
}

function requiredGenderFromSelection(values) {
  const genders = [
    ...new Set(
      (values || [])
        .map(value => String(value).toLowerCase())
        .filter(value => value === "girl" || value === "boy")
    )
  ];

  if (genders.includes("girl") && genders.includes("boy")) {
    return "either";
  }

  return genders[0] || "";
}

function closedPostContent(eventName, startAt) {
  return [
    publicPostContent(eventName, startAt),
    "",
    "*This LFG post is now closed.*"
  ].join("\n");
}

module.exports = {
  POST_CUSTOM,
  TIER_OPTIONS,
  GENDER_OPTIONS,
  POST_GENDER_LABEL,
  isLfgPostCustomId,
  discordTimestamp,
  publicPostContent,
  publicPostRows,
  staffEventSelectRow,
  staffModeSelectRow,
  staffRoleSelectRow,
  staffEveryoneSelectRow,
  fillManageRows,
  needManageRows,
  needNotifyStopRows,
  needFlowRows,
  fillMatchDm,
  formatNeedSummary,
  requiredGenderFromSelection,
  closedPostContent
};
