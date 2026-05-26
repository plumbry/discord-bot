require("dotenv").config();

const { ensureRulesModulesSheet } = require("../lib/rulesModulesSheet");
const { DEFAULT_RULES_MODULE_CONTENT } = require("../lib/rulesModuleDefaults");
const { getSheets } = require("../lib/sheets");

const GUILD_ID = process.env.GUILD_ID || "1371615693392576580";

async function seedRulesModules() {
  if (!process.env.MAIN_SHEET_ID) {
    throw new Error("MAIN_SHEET_ID is not set");
  }

  await ensureRulesModulesSheet();

  const existingRes = await getSheets().spreadsheets.values.get({
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: "Rules Modules!A2:E"
  });
  const existing = existingRes.data.values || [];
  const hasData = existing.some(row => {
    const module = String(row[0] || "")
      .trim()
      .toLowerCase();

    return module && module !== "module";
  });

  if (hasData) {
    console.log(
      "Rules Modules tab already has rows — skipping seed (delete rows to re-seed)."
    );
    return;
  }

  const updatedAt = new Date().toISOString();
  const values = Object.entries(DEFAULT_RULES_MODULE_CONTENT).map(
    ([moduleKey, content]) => [
      moduleKey,
      GUILD_ID,
      "",
      content,
      updatedAt
    ]
  );

  await getSheets().spreadsheets.values.update({
    spreadsheetId: process.env.MAIN_SHEET_ID,
    range: "Rules Modules!A2",
    valueInputOption: "RAW",
    requestBody: { values }
  });

  console.log(`Seeded ${values.length} module(s) for guild ${GUILD_ID}.`);
}

seedRulesModules().catch(err => {
  console.error(err);
  process.exit(1);
});
