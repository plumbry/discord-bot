require("dotenv").config();

const { listPresets, getPreset } = require("../lib/rulesSheet");

const GUILD_ID = process.env.GUILD_ID || "1371615693392576580";
const LOOKUP = process.argv[2] || "";

(async () => {
  const presets = await listPresets(GUILD_ID);

  console.log(`Guild ${GUILD_ID}: ${presets.length} preset(s)`);

  for (const preset of presets) {
    console.log(
      `- key=${preset.key} name=${preset.name} bans=${preset.extraBans?.length || 0}`
    );
  }

  if (LOOKUP) {
    const hit = await getPreset(GUILD_ID, LOOKUP);
    console.log(`\nLookup "${LOOKUP}":`, hit ? "found" : "NOT FOUND");

    if (hit) {
      console.log(JSON.stringify(hit, null, 2));
    }
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
