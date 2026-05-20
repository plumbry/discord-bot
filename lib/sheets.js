const { google } = require("googleapis");

const DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets"
];

let authClient = null;
let sheetsClient = null;

function getCredentials() {

  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

  if (!raw) {
    return null;
  }

  return JSON.parse(
    Buffer.from(raw, "base64").toString("utf8")
  );

}

function getAuth(
  scopes = DEFAULT_SCOPES
) {

  const credentials = getCredentials();

  if (!credentials) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not configured"
    );
  }

  if (!authClient) {
    authClient = new google.auth.GoogleAuth({
      credentials,
      scopes
    });
  }

  return authClient;

}

function getSheets(
  scopes = DEFAULT_SCOPES
) {

  if (!sheetsClient) {
    sheetsClient = google.sheets({
      version: "v4",
      auth: getAuth(scopes)
    });
  }

  return sheetsClient;

}

module.exports = {
  getSheets,
  getAuth,
  getCredentials,
  DEFAULT_SCOPES
};
