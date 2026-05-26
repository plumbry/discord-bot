const CREATE_TICKET_URL =
  "https://discord.com/channels/1371615693392576580/1371651766407532654";

/** Default section bodies used when the Rules Modules tab has no row for that module. */
const DEFAULT_RULES_MODULE_CONTENT = {
  kill_cap: [
    "",
    "**THERE WILL BE A {{killCap}} KILL CAP!**",
    "- Meaning, if you go over {{killCap}} kills in a game you will receive -2 points for each kill that's over the cap!"
  ].join("\n"),
  game_rules: [
    "## :ZBDCROWN: GAME RULES :ZBDCROWN:",
    "- Anonymous Mode MUST be turned OFF",
    "- Any form of negativity or toxicity towards ANY player, admin or host will NOT be tolerated and will have consequences",
    "- No teaming",
    "- No cheating",
    "- No Stream Sniping",
    "- Skipping an event to play another tournament at the same time will result in an event ban",
    "- Only restarting the game if 2+ **FULL** teams didn't get in the Battle Bus",
    "- If the same team bricks **twice** in a single event, we will restart the game",
    `- If you believe someone has broken any rules please [#create-ticket](${CREATE_TICKET_URL}) and let us know with PROOF`
  ].join("\n"),
  tier_restrictions_solo: [
    "## TIER RESTRICTIONS",
    "-# Want to check Tier Restrictions? [Click Here]({{tierUrl}})"
  ].join("\n"),
  tier_restrictions_team: [
    "## TIER RESTRICTIONS FOR {{modeFormat}}",
    "-# Want to check Tier Restrictions? [Click Here]({{tierUrl}})"
  ].join("\n"),
  streaming: [
    "## 🖥️ STREAMING 🖥️",
    "{{streamPlayers}} PLAYER{{streamPlayersPlural}} PER {{modeLabelUpper}} MUST STREAM on twitch",
    "- Stream Title: {{streamTitle}}",
    "- VODs need to stay up for at least 24 hrs after each event",
    "- Full in-game audio must be hearable, including all teammates' comms",
    "🎥 All stream links must be posted in the channel before each event start!",
    "-# If you are streaming from console, use gamechat for comms to be audible"
  ].join("\n"),
  dropmap_on: [
    "## 🗺️ DROP MAP 🗺️",
    "- MANDATORY",
    "- Each PERSON mark on the map",
    "{{separateDropmapsLine}}",
    "📍 If you don't mark your dropspot in time, an admin will choose one for you",
    "- You cannot modify or extend the premade box",
    "- NO QUAD CONNING",
    "-# You must land in your team's marked box. Landing and looting outside of your box offspawn is considered a rule break.",
    "{{dropmapExtraLine}}"
  ].join("\n"),
  dropmap_off: ["## 🗺️ DROP MAP 🗺️", "- No dropmap for this event."].join("\n"),
  penalties: [
    "**:ZBDMOD: PENALTIES FOR RULE BREAKS & USE OF BANNED ITEMS :ZBDHAMMER:**",
    "- *No warnings!*",
    "- **1st offense**: -{{firstPenalty}} points",
    "- **2nd offense**: -{{secondPenalty}} points",
    "- **3rd offense**: {{thirdPenalty}}"
  ].join("\n"),
  special_game_rules_title: "### SPECIAL GAME RULES"
};

const RULES_MODULE_KEYS = Object.keys(DEFAULT_RULES_MODULE_CONTENT);

module.exports = {
  DEFAULT_RULES_MODULE_CONTENT,
  RULES_MODULE_KEYS
};
