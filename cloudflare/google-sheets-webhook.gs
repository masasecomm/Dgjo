const SHEET_HEADERS = [
  "Record ID",
  "Record type",
  "Full name",
  "Email",
  "Province",
  "Department",
  "Status",
  "CV text part 1",
  "CV text part 2",
  "CV text part 3",
  "Consent timestamp",
  "Created timestamp",
  "Updated timestamp"
];
const CV_TEXT_CELL_LIMIT = 45000;

function doPost(event) {
  try {
    const body = event && event.postData && event.postData.contents;
    if (typeof body !== "string" || body.length > 600000) {
      return jsonResponse({ success: false, error: "Invalid request." });
    }

    const record = JSON.parse(body);
    const properties = PropertiesService.getScriptProperties();
    const expectedSecret = properties.getProperty("SHEET_WEBHOOK_SECRET");
    const spreadsheetId = properties.getProperty("SHEET_ID");
    const sheetName = properties.getProperty("SHEET_NAME") || "DPSAWebsite";
    if (!expectedSecret || record.secret !== expectedSecret || !spreadsheetId) {
      return jsonResponse({ success: false, error: "Unauthorized or not configured." });
    }
    if (!["append", "upsert"].includes(record.action) ||
        !["cv_match", "email_alert"].includes(record.recordType) ||
        typeof record.recordId !== "string" || !record.recordId ||
        typeof record.name !== "string" || typeof record.email !== "string" ||
        typeof record.province !== "string" || typeof record.department !== "string" ||
        typeof record.status !== "string") {
      return jsonResponse({ success: false, error: "Invalid record." });
    }
    if (record.recordType === "cv_match" &&
        (record.action !== "append" || typeof record.cvText !== "string" ||
         record.cvText.length < 60 || record.cvText.length > 120000)) {
      return jsonResponse({ success: false, error: "Invalid CV record." });
    }
    if (record.recordType === "email_alert" && record.action !== "upsert") {
      return jsonResponse({ success: false, error: "Invalid alert record." });
    }

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return jsonResponse({ success: false, error: "Please retry." });
    try {
      const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
      if (!sheet) return jsonResponse({ success: false, error: "The configured sheet tab was not found." });
      const columns = ensureHeaders(sheet);
      const row = record.action === "upsert"
        ? findRecordRow(sheet, columns["Record ID"], record.recordId)
        : 0;
      const targetRow = row || sheet.getLastRow() + 1;
      const cvParts = record.recordType === "cv_match" ? splitText(record.cvText, CV_TEXT_CELL_LIMIT) : [];
      const values = {
        "Record ID": record.recordId,
        "Record type": record.recordType,
        "Full name": record.name,
        "Email": record.email,
        "Province": record.province,
        "Department": record.department,
        "Status": record.status,
        "CV text part 1": cvParts[0] || "",
        "CV text part 2": cvParts[1] || "",
        "CV text part 3": cvParts[2] || "",
        "Consent timestamp": record.consentedAt || "",
        "Created timestamp": row ? sheet.getRange(row, columns["Created timestamp"]).getDisplayValue() : (record.consentedAt || new Date().toISOString()),
        "Updated timestamp": record.updatedAt || new Date().toISOString()
      };

      SHEET_HEADERS.forEach(header => {
        const cell = sheet.getRange(targetRow, columns[header]);
        cell.setNumberFormat("@");
        cell.setValue(asPlainText(values[header]));
      });
      return jsonResponse({ success: true });
    } finally {
      lock.releaseLock();
    }
  } catch (_error) {
    return jsonResponse({ success: false, error: "Could not write the record." });
  }
}

function ensureHeaders(sheet) {
  const lastColumn = sheet.getLastColumn();
  const currentHeaders = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    : [];
  const columns = {};
  currentHeaders.forEach((value, index) => {
    const header = String(value).trim();
    if (SHEET_HEADERS.includes(header) && !columns[header]) columns[header] = index + 1;
  });

  let nextColumn = lastColumn;
  SHEET_HEADERS.forEach(header => {
    if (columns[header]) return;
    nextColumn += 1;
    sheet.getRange(1, nextColumn).setValue(header);
    columns[header] = nextColumn;
  });
  return columns;
}

function findRecordRow(sheet, idColumn, recordId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, idColumn, lastRow - 1, 1).getDisplayValues();
  const index = ids.findIndex(row => row[0] === recordId);
  return index < 0 ? 0 : index + 2;
}

function splitText(value, chunkSize) {
  const chunks = [];
  let chunk = "";
  for (const character of value) {
    if (chunk.length + character.length > chunkSize) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  if (chunks.length > 3) throw new Error("CV text exceeds the supported spreadsheet size.");
  return chunks;
}

function asPlainText(value) {
  const text = String(value == null ? "" : value);
  return /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
