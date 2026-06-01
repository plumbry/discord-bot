/**
 * Google Apps Script — attach to the spreadsheet that contains "Event Bans".
 *
 * 1. Extensions → Apps Script → paste this file.
 * 2. Project Settings → Script properties:
 *      WEBHOOK_URL   = https://welcome-ping.fly.dev/webhooks/role-sync
 *                      (legacy: /webhooks/event-bans — empty body triggers poll)
 *      WEBHOOK_SECRET = (same value as bot env EVENT_BAN_WEBHOOK_SECRET)
 * 3. Triggers → Add trigger → onChange → onSpreadsheetChange (From spreadsheet).
 *
 * Fires when the sheet is edited (including API/website writes).
 */

function onSpreadsheetChange(e) {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("WEBHOOK_URL");
  const secret = props.getProperty("WEBHOOK_SECRET");

  if (!url || !secret) {
    console.warn("WEBHOOK_URL or WEBHOOK_SECRET not set in script properties");
    return;
  }

  UrlFetchApp.fetch(url, {
    method: "post",
    headers: {
      Authorization: "Bearer " + secret,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify({
      source: "google-sheets",
      changeType: e && e.changeType ? e.changeType : ""
    }),
    muteHttpExceptions: true
  });
}
