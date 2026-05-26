require("dotenv").config();

const { ensureRulesSheet } = require("../lib/rulesSheet");
const { ensureRulesModulesSheet } = require("../lib/rulesModulesSheet");
const { ensureRulesPostsSheet } = require("../lib/rulesPostsSheet");
const { ensureRulesLibrarySheet } = require("../lib/rulesSuggestionsSheet");

(async () => {
  if (!process.env.MAIN_SHEET_ID) {
    console.error("MAIN_SHEET_ID is not set");
    process.exit(1);
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    console.error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not set");
    process.exit(1);
  }

  console.log("Ensuring Rules tab headers...");
  await ensureRulesSheet();
  console.log("OK: Rules");

  console.log("Ensuring Rules Modules tab headers...");
  await ensureRulesModulesSheet();
  console.log("OK: Rules Modules");

  console.log("Ensuring Rules Posts tab headers...");
  await ensureRulesPostsSheet();
  console.log("OK: Rules Posts");

  console.log("Ensuring Rules Library tab headers...");
  await ensureRulesLibrarySheet();
  console.log("OK: Rules Library");

  console.log("Done.");
})().catch(err => {
  console.error(err);
  process.exit(1);
});
