// DEBUG key before import
console.log("DEBUG - OPENAI_API_KEY (before imports):", !!process.env.OPENAI_API_KEY);

import express from "express";
import dotenv from "dotenv";
import twilioPkg from "twilio";
import clientConfig from "./client-config.js";
import { handleRecording } from "./processRecording.js";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();                       // load .env first

const twilio = twilioPkg;
const app = express();                 // create app BEFORE app.use
const PORT = process.env.PORT || 3000;

/* ----------- STATIC /audio ------------ */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use("/audio", express.static(path.join(__dirname, "public/audio")));

/* -------------- MIDDLEWARE ------------ */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* --------------- /VOICE --------------- */
app.post("/voice", (req, res) => {
  const { client: clientId = "helpflow" } = req.query;
  const cfg = clientConfig.clients[clientId];
  if (!cfg) return res.status(400).send("Unknown client");

  const twiml = new twilio.twiml.VoiceResponse();
  if (cfg.scripts.greeting) twiml.say({ voice: "alice" }, cfg.scripts.greeting);

  twiml.record({
    action: `/process-recording?client=${clientId}`,
    method: "POST",
    playBeep: true,
    trim: "silence",
    maxLength: 30,
  });

  res.type("text/xml").send(twiml.toString());
});

/* -------- /PROCESS-RECORDING ---------- */
app.post("/process-recording", handleRecording);

/* -------- Root + test -------- */
app.get("/", (_, r) => r.send("🚀 HelpFlow AI Server"));
app.listen(PORT, () => console.log(`✅ Server on ${PORT}`));





