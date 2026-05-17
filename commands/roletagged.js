const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { google } = require("googleapis");

// ================= CONSTANTS =================
const LOG_CHANNEL_ID = "1471082166535454780";
const SHEET_ID = process.env.MAIN_SHEET_ID;
const AUDIT_RANGE = "Audit Log!A:G";

const MESSAGE_SCAN_LIMIT = 100;
const ROLE_DELAY_MS = 750;

const BLOCKED_ROLE_ID = "1463660686231207956";

// ================= EMOJIS =================
const ACCEPTED_EMOJI_ID = "1405510864496361482";

const NUMBER_EMOJIS = {
  "0": "1405509686194864188",
  "1": "1405509032705392685",
  "2": "1405509125500309636",
  "3": "1405509179291992165",
  "4": "1405509225144389734",
  "5": "1405509441054572577",
  "6": "1405509486533148763",
  "7": "1405509549246386218",
  "8": "1405509615529230347",
  "9": "1405509655702274210"
};

const DUPLICATE_NUMBER_EMOJIS = {
  "1": "1436347038630416499",
  "2": "1436348495102480424",
  "3": "1436348527448952923",
  "4": "1436348563591266424",
  "5": "1436348591986708601",
  "6": "1436348649616707695",
  "7": "1436348677341053069",
  "8": "1436348705652478004",
  "9": "1436348734731587645"
};

// ================= RELOAD =================
const MAX_RELOAD_TEAMS = 20;

const RELOAD_STOP_EMOJI = "✋";

const RELOAD_K_EMOJI =
  "1435978450958553130";

// ================= GOOGLE =================
const credentials = JSON.parse(
  Buffer.from(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    "base64"
  ).toString("utf8")
);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({
  version: "v4",
  auth
});

// ================= HELPERS =================
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const isoNow = () => new Date().toISOString();

async function logAudit(data) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: AUDIT_RANGE,
    valueInputOption: "RAW",
    requestBody: {
      values: [[
        isoNow(),
        data.action,
        data.moderator.id,
        data.moderator.tag,
        "",
        "",
        data.context
      ]]
    }
  });
}

// ================= COMMAND =================
module.exports = {

  data: new SlashCommandBuilder()
    .setName("roletagged")
    .setDescription("Give roles to tagged users from signups")

    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to give")
        .setRequired(true)
    )

    .addStringOption(o =>
      o.setName("mode")
        .setDescription("Team size")
        .setRequired(true)
        .addChoices(
          { name: "Duos", value: "2" },
          { name: "Trios", value: "3" },
          { name: "Squads", value: "4" }
        )
    )

    .addBooleanOption(o =>
      o.setName("skip")
        .setDescription("Ignore event banned checks")
        .setRequired(false)
    )

    .addBooleanOption(o =>
      o.setName("reload")
        .setDescription("Reload mode (max 20 teams get roles)")
        .setRequired(false)
    )

    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageRoles
    ),

  async execute(interaction) {

    if (!process.env.MAIN_SHEET_ID) {
      return interaction.reply({
        content: "MAIN_SHEET_ID not configured.",
        ephemeral: true
      });
    }

    const role =
      interaction.options.getRole("role");

    const ignoreBlocked =
      interaction.options.getBoolean("skip") || false;

    const isReload =
      interaction.options.getBoolean("reload") || false;

    const requiredTeamSize =
      parseInt(
        interaction.options.getString("mode")
      );

    const channel = interaction.channel;
    const guild = interaction.guild;

    await interaction.reply(
      "Scanning signups..."
    );

    const messages =
      await channel.messages.fetch({
        limit: MESSAGE_SCAN_LIMIT
      });

    await guild.members.fetch();

    const taggedUserIds = new Set();

    const validTeams = [];

    const candidateTeams = [];

    const playerSignupMap =
      new Map();

    const orderedMessages =
      [...messages.values()].reverse();

    // ================= SCAN =================

    for (const msg of orderedMessages) {

      const users =
        [...msg.mentions.users.values()]
        .filter(u => !u.bot);

      if (users.length === 0)
        continue;

      // Wrong team size
      if (
        users.length !== requiredTeamSize
      ) {
        continue;
      }

      candidateTeams.push({
        message: msg,
        users
      });

      for (const user of users) {

        if (
          !playerSignupMap.has(
            user.id
          )
        ) {
          playerSignupMap.set(
            user.id,
            []
          );
        }

        playerSignupMap
          .get(user.id)
          .push(msg.id);
      }
    }

    // ================= DUPLICATES =================

    const duplicatePlayers =
      new Set();

    for (const [id, signups]
      of playerSignupMap) {

      if (
        signups.length > 1
      ) {
        duplicatePlayers.add(
          id
        );
      }
    }

    // ================= VALIDATE =================

    for (const team of candidateTeams) {

      const hasDuplicate =
        team.users.some(
          u =>
          duplicatePlayers.has(
            u.id
          )
        );

      if (hasDuplicate) {

        try {

          await channel.send(
            `Rejected signup (duplicate player): ${team.users.map(
              u => `<@${u.id}>`
            ).join(" ")}`
          );

        } catch {}

        continue;
      }

      let blockedMember =
        null;

      if (
        !ignoreBlocked
      ) {

        for (const user of team.users) {

          const member =
            guild.members.cache.get(
              user.id
            );

          if (
            member?.roles.cache.has(
              BLOCKED_ROLE_ID
            )
          ) {
            blockedMember =
              member;
            break;
          }
        }
      }

      if (
        blockedMember
      ) {

        try {

          await channel.send(
            `${blockedMember} cannot sign up. Entire signup skipped.`
          );

        } catch {}

        continue;
      }

      validTeams.push(
        team
      );

      for (
        const user
        of team.users
      ) {

        taggedUserIds.add(
          user.id
        );
      }
    }

    if (
      validTeams.length === 0
    ) {

      return interaction.editReply(
        "No eligible signups found."
      );
    }

    // ================= ROLE ASSIGNMENT =================

    let added = 0;
    let skipped = 0;

    const roledTeams =
      isReload
        ? validTeams.slice(0, MAX_RELOAD_TEAMS)
        : validTeams;

    const overflowTeams =
      isReload
        ? validTeams.slice(MAX_RELOAD_TEAMS)
        : [];

    const roledUserIds =
      new Set();

    for (
      const team
      of roledTeams
    ) {

      for (
        const user
        of team.users
      ) {

        roledUserIds.add(
          user.id
        );
      }
    }

    for (
      const userId
      of roledUserIds
    ) {

      const member =
        guild.members.cache.get(
          userId
        );

      if (
        !member
      ) continue;

      if (
        member.roles.cache.has(
          role.id
        )
      ) {

        skipped++;
        continue;
      }

      try {

        await member.roles.add(
          role
        );

        added++;

      } catch (err) {

        console.error(
          err
        );
      }

      await delay(
        ROLE_DELAY_MS
      );
    }

    // ================= REACTIONS =================

    let teamNumber = 1;

    for (
      const team
      of roledTeams
    ) {

      try {

        await team.message.fetch();

        const existing =
          team.message.reactions.cache.map(
            r => r.emoji.id
          );

        if (
          !existing.includes(
            ACCEPTED_EMOJI_ID
          )
        ) {

          await team.message.react(
            ACCEPTED_EMOJI_ID
          );

          await delay(
            500
          );
        }

        const digits =
          teamNumber
          .toString()
          .split("");

        const digitUsage = {};

        for (
          const digit
          of digits
        ) {

          if (
            !digitUsage[digit]
          ) {
            digitUsage[digit] = 0;
          }

          digitUsage[digit]++;

          let emojiId;

          if (
            digitUsage[digit] === 1
          ) {

            emojiId =
              NUMBER_EMOJIS[
                digit
              ];

          } else {

            emojiId =
              DUPLICATE_NUMBER_EMOJIS[
                digit
              ];
          }

          if (
            !emojiId
          ) continue;

          if (
            !existing.includes(
              emojiId
            )
          ) {

            await team.message.react(
              emojiId
            );

            await delay(
              500
            );
          }
        }

      } catch (err) {

        console.error(
          "[REACT ERROR]",
          err
        );
      }

      teamNumber++;
    }

    // ================= RELOAD OVERFLOW =================

    if (
      isReload &&
      overflowTeams.length > 0
    ) {

      let overflowNumber = 1;

      for (
        const team
        of overflowTeams
      ) {

        try {

          await team.message.react(
            RELOAD_STOP_EMOJI
          );

          await delay(500);

          await team.message.react(
            RELOAD_K_EMOJI
          );

          await delay(500);

          const digits =
            overflowNumber
            .toString()
            .split("");

          const digitUsage = {};

          for (
            const digit
            of digits
          ) {

            if (
              !digitUsage[digit]
            ) {
              digitUsage[digit] = 0;
            }

            digitUsage[digit]++;

            let emojiId;

            if (
              digitUsage[digit] === 1
            ) {

              emojiId =
                NUMBER_EMOJIS[
                  digit
                ];

            } else {

              emojiId =
                DUPLICATE_NUMBER_EMOJIS[
                  digit
                ];
            }

            if (
              !emojiId
            ) continue;

            await team.message.react(
              emojiId
            );

            await delay(500);
          }

        } catch (err) {

          console.error(
            "[OVERFLOW REACT ERROR]",
            err
          );
        }

        overflowNumber++;
      }
    }

    // ================= RESULTS =================

    const result =

      "Role assignment complete\n" +
      "Mode: " + requiredTeamSize + "\n" +
      "Reload: " + (isReload ? "Yes" : "No") + "\n" +
      "Role: " + role.name + "\n" +
      "Added: " + added + "\n" +
      "Skipped: " + skipped + "\n" +
      "Valid Teams: " + validTeams.length + "\n" +
      "Roled Teams: " + roledTeams.length + "\n" +
      "Overflow Teams: " + overflowTeams.length;

    await interaction.editReply(
      result
    );

    // ================= LOG =================

    try {

      const logChannel =
        await guild.channels.fetch(
          LOG_CHANNEL_ID
        );

      await logChannel.send(

        "Role Assigned via /roletagged\n" +
        "Moderator: " +
        interaction.user.tag +
        "\nRole: " +
        role.name +
        "\nMode: " +
        requiredTeamSize +
        "\nReload: " +
        (isReload ? "Yes" : "No") +
        "\nTeams: " +
        validTeams.length
      );

    } catch {}

    try {

      await logAudit({

        action:
        "ROLE_TAGGED_ASSIGN",

        moderator:
        interaction.user,

        context:
        `role=${role.id} mode=${requiredTeamSize} reload=${isReload} teams=${validTeams.length}`
      });

    } catch (err) {

      console.error(
        err
      );
    }

  }
};