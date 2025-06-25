// utils/airtable.js
// -----------------------------------------------------------------------------
// Airtable logging helper for HelpFlow AI voice bot
// -----------------------------------------------------------------------------
// • Grabs env vars safely (works in local dev & Railway)
// • Validates that required vars exist
// • Provides a single function `logCallToAirtable` for recording each call turn
//   to the **Call Logs** table using your exact field names.
// -----------------------------------------------------------------------------

import dotenv from "dotenv";
dotenv.config();

import Airtable from "airtable";

const {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_NAME = "Call Logs", // default just in case
} = process.env;

if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  throw new Error("Missing Airtable env vars: AIRTABLE_API_KEY or AIRTABLE_BASE_ID");
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID);

/**
 * Write one row to the Call Logs table.
 * Pass only what you have—undefined fields are skipped automatically.
 */
export async function logCallToAirtable({
  callId,
  client = "HelpFlow AI",
  callerNumber,
  dateTime = new Date(),
  callStatus,
  recordingUrl,
  transcript,
  intent,
  outcome,
}) {
  try {
    await base(AIRTABLE_TABLE_NAME).create({
      "Call ID": callId,
      "Client": client,
      "Caller Number": callerNumber,
      "Date And Time": dateTime.toISOString(),
      "Call Status": callStatus,
      "Recording URL": recordingUrl,
      Transcript: transcript,
      "Intent Detected": intent,
      Outcome: outcome,
    });
    console.log("✅  Airtable row created");
  } catch (err) {
    console.error("🔴 Airtable write failed:", err?.statusCode, err?.message);
  }
}

