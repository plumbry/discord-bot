/**
 * Parse date/time values from Google Sheets cells.
 * Sheets may return serial numbers (UNFORMATTED_VALUE), ISO strings, or locale strings.
 */

function googleSerialToDate(serial) {
  // Google Sheets epoch: 1899-12-30 UTC
  return new Date((serial - 25569) * 86400000);
}

function parseSheetDateTime(raw) {
  if (raw === "" || raw == null) {
    return new Date(NaN);
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return googleSerialToDate(raw);
  }

  const trimmed = String(raw).trim();

  if (!trimmed) {
    return new Date(NaN);
  }

  const asNum = Number(trimmed);

  if (Number.isFinite(asNum) && asNum > 20_000 && asNum < 200_000) {
    return googleSerialToDate(asNum);
  }

  const iso = new Date(trimmed);

  if (!Number.isNaN(iso.getTime())) {
    return iso;
  }

  // DD/MM/YYYY [H:MM[:SS]] — common UK Sheets display format
  const uk = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (uk) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = uk;

    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
  }

  return new Date(NaN);
}

module.exports = {
  googleSerialToDate,
  parseSheetDateTime
};
