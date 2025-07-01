// utils/airtable.js
// -----------------------------------------------------------------------------
// Airtable helper for HelpFlow AI voice bot
// Provides generic fetch and upsert functions for any table
// Includes a direct-run block for quick testing when executed alone
// -----------------------------------------------------------------------------
import dotenv from "dotenv";
dotenv.config();

import Airtable from "airtable";
import { fileURLToPath } from "url";
import { dirname } from "path";

const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
  throw new Error(
    "Missing Airtable env vars: AIRTABLE_API_KEY or AIRTABLE_BASE_ID"
  );
}

const base = new Airtable({ apiKey: AIRTABLE_API_KEY }).base(
  AIRTABLE_BASE_ID
);

/**
 * Fetch records from any table.
 * @param {string} tableName – e.g. "Scripts", "FAQs", "Clients"
 * @param {object} [opts] – Airtable select options (maxRecords, filterByFormula, etc.)
 * @returns {Promise<Array<object>>} – Array of record objects with id and fields
 */
export async function fetchFromAirtable(tableName, opts = {}) {
  try {
    const records = await base(tableName).select(opts).firstPage();
    return records.map((rec) => ({ id: rec.id, ...rec.fields }));
  } catch (err) {
    console.error(`🔴 Error fetching from ${tableName}:`, err);
    throw err;
  }
}

/**
 * Create or update a record in any table.
 * @param {string} tableName
 * @param {object} fields – fieldName: value
 * @param {string} [recordId] – if provided, will update; otherwise create
 * @returns {Promise<object[]>} – Airtable API response
 */
export async function upsertToAirtable(tableName, fields, recordId) {
  try {
    const method = recordId ? "update" : "create";
    const payload = recordId
      ? [{ id: recordId, fields }]
      : [{ fields }];
    const response = await base(tableName)[method](payload);
    console.log(
      `✅  ${recordId ? "Updated" : "Created"} record in ${tableName}`
    );
    return response;
  } catch (err) {
    console.error(
      `🔴 Error upserting to ${tableName}:`, err.statusCode || err
    );
    throw err;
  }
}

// Legacy convenience function for call logs (optional)
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
    await base("Call Logs").create({
      "Call ID": callId,
      Client: client,
      "Caller Number": callerNumber,
      "Date and time": dateTime.toISOString(),
      "Call Status": callStatus,
      "Recording URL": recordingUrl,
      Transcript: transcript,
      "Intent Detected": intent,
      Outcome: outcome,
    });
    console.log("✅  Airtable row created in Call Logs");
  } catch (err) {
    console.error("🔴 Airtable write failed in Call Logs:", err?.statusCode, err?.message);
  }
}

// -------------------------------------------------------------
// Quick test block: run this file directly (ESM-safe)
// -------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (process.argv[1] === __filename) {
  (async () => {
    const clientId = "recXXXXXXXXXXXXX"; // replace with a real Client record ID

    console.log(`\n🔎 Fetching Scripts for client ${clientId}...`);
    try {
      const scripts = await fetchFromAirtable("Scripts", {
        filterByFormula: `{Client} = "${clientId}"`,
      });
      console.log("Scripts:", scripts);
    } catch (e) {
      console.error("Failed to fetch Scripts:", e);
    }

    console.log(`\n🔎 Fetching FAQs for client ${clientId}...`);
    try {
      const faqs = await fetchFromAirtable("FAQs", {
        filterByFormula: `{Client} = "${clientId}"`,
      });
      console.log("FAQs:", faqs);
    } catch (e) {
      console.error("Failed to fetch FAQs:", e);
    }
  })();
}
