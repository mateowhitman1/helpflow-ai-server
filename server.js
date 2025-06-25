// server.js
// -----------------------------------------------------------------------------
// Main entry for the HelpFlow AI voice‑bot server
// -----------------------------------------------------------------------------
// Key fixes / upgrades:
//   • Loads `dotenv` **before** any other imports so env vars are available
//   • Adds basic env‑var validation & a health‑check route
//   • Leaves Twilio + client routing intact
//   • Compatible with the new `logCallToAirtable` helper inside processRecording.js
// -----------------------------------------------------------------------------

import "dotenv/config"; // <‑‑ ensures env vars are loaded first

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import twilioPkg from "twilio";

import clientConfig from "./client-config.js";
import { handleRecording } from "./processRecording.js";

/* ---------- Paths & folders ------------------------------------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Make sure public/audio exists (for ElevenLabs MP3s)
const audioDir = path.join(__dirname, "public", "audio");
fs.mkdirSync(audioDir, { recursive: true });

/* ---------- Basic env‑var sanity check -------------------------------------- */
["OPENAI_API_KEY", "ELEVENLABS_API_KEY", "AIRTABLE_API_KEY", "AIRTABLE_BASE_ID"].forEach(
  (key) => {
    if (!process.env[key]) console.warn(`⚠️  Missing env var: ${key}`);
  }
);

/* ---------- App & middleware ---------------------------------------------- */
const app  = express();
const PORT = process.env.PORT || 8080; // Railway usually sets PORT

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static route for generated speech files
app.use("/audio", express.static(audioDir));

const twilio = twilioPkg;

/* ---------- Routes --------------------------------------------------------- */
// Health‑check so Railway marks the service healthy
app.get("/", (_, res) => res.send("👍 OK – HelpFlow AI server is live"));

// Twilio entry‑point – greets caller then records
app.post("/voice", (req, res) => {
  try {
    const { client: clientId = "helpflow" } = req.query;
    const cfg = clientConfig.clients?.[clientId];
    if (!cfg) return res.status(400).send("Unknown client");

    const vr = new twilio.twiml.VoiceResponse();
    vr.say({ voice: "alice" }, cfg.scripts.greeting);

    vr.record({
      action   : `/process-recording?client=${clientId}`,
      method   : "POST",
      maxLength: 30,
      playBeep : true,
      trim     : "silence",
    });

    res.type("text/xml").send(vr.toString());
  } catch (err) {
    console.error("❌ /voice error:", err);
    res.status(500).send("Voice webhook failure");
  }
});

// Delegate recording processing (includes Airtable logging)
app.post("/process-recording", handleRecording);

/* ---------- Boot ----------------------------------------------------------- */
app.listen(PORT, () => console.log(`✅  Server listening on ${PORT}`));




