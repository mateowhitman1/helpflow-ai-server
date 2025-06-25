// server.js
import express        from "express";
import dotenv         from "dotenv";
import path           from "path";
import { fileURLToPath } from "url";
import fs             from "fs";
import twilioPkg      from "twilio";

import clientConfig      from "./client-config.js";
import { handleRecording } from "./processRecording.js";

dotenv.config();

/* ---------- Paths & folders ------------------------------------------------ */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// make sure  public/audio  exists (for ElevenLabs MP3s)
const audioDir = path.join(__dirname, "public", "audio");
if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

/* ---------- App & middleware ---------------------------------------------- */
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// static route for generated speech
app.use("/audio", express.static(audioDir));

const twilio = twilioPkg;

/* ---------- Routes --------------------------------------------------------- */
app.get("/", (_, res) => res.send("🚀 HelpFlow AI server is running!"));

app.post("/voice", (req, res) => {
  try {
    const { client: clientId = "helpflow" } = req.query;
    const cfg = clientConfig.clients[clientId];
    if (!cfg) return res.status(400).send("Unknown client");

    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say({ voice: "alice" }, cfg.scripts.greeting);

    twiml.record({
      action   : `/process-recording?client=${clientId}`,
      method   : "POST",
      maxLength: 30,
      playBeep : true,
      trim     : "silence",
    });

    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("❌ /voice error:", err);
    res.status(500).send("Voice webhook failure");
  }
});

app.post("/process-recording", handleRecording);

/* ---------- Boot ----------------------------------------------------------- */
app.listen(PORT, () => console.log(`✅  Server listening on ${PORT}`));





