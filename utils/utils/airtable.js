// utils/airtable.js
import Airtable from "airtable";

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID
);

/**
 * Write a call record to the “Call Logs” table.
 * Fields must match EXACTLY what exists in Airtable.
 */
export async function logCallToAirtable({
  callId,
  caller,
  transcript,
  intent,
  outcome,
  recordingUrl,
}) {
  return base("Call Logs").create({
    "Call ID": callId,
    "Caller Number": caller,
    Transcript: transcript,
    "Intent Detected": intent,
    Outcome: outcome,
    "Recorded URL": recordingUrl,
    "Date and Time": new Date().toISOString(),
  });
}
