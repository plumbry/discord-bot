const { getPreset } = require("./rulesSheet");

/** Point penalties by game type (shown as -N in rules text). */
const GAME_TYPES = {
  br: {
    key: "br",
    label: "Main BR",
    firstPenalty: 20,
    secondPenalty: 40,
    thirdPenaltyText: "Disqualification"
  },
  reload: {
    key: "reload",
    label: "Reload",
    firstPenalty: 15,
    secondPenalty: 30,
    thirdPenaltyText: "Disqualification"
  }
};

const FORMAT_CHOICES = [
  { name: "Duos", value: "duo" },
  { name: "Trios", value: "trio" },
  { name: "Squads", value: "squad" }
];

function isGameType(value) {
  return value === "br" || value === "reload";
}

function formatGamePresetNotFoundMessage(gameKey, guildId) {
  return (
    `No **${gameKey}** preset on the **Rules** tab.\n\n` +
    "Add a row with Key `br` or `reload`, Guild ID:\n" +
    `\`${guildId}\`, plus extra bans in column G.`
  );
}

async function resolveGamePreset(guildId, gameKey) {
  const game = GAME_TYPES[gameKey];

  if (!game) {
    return null;
  }

  const sheetPreset = await getPreset(guildId, game.key);

  if (!sheetPreset) {
    return null;
  }

  return {
    ...sheetPreset,
    gameKey: game.key,
    gameLabel: game.label,
    firstPenalty: game.firstPenalty,
    secondPenalty: game.secondPenalty,
    thirdPenaltyText: game.thirdPenaltyText
  };
}

module.exports = {
  GAME_TYPES,
  FORMAT_CHOICES,
  isGameType,
  formatGamePresetNotFoundMessage,
  resolveGamePreset
};
