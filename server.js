// Log the key BEFORE any imports (to see what's available at runtime)
console.log("DEBUG - OPENAI_API_KEY (before imports):", JSON.stringify(process?.env?.OPENAI_API_KEY));

import express from "express";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import twilio from "twilio";

// Load .env file locally — safe on Railway too
dotenv.config();

// Log the key AFTER dotenv runs (should match before if on Railway)
console.log("DEBUG - OPENAI_API_KEY (after dotenv):", JSON.stringify(process?.env?.OPENAI_API_KEY));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Twilio client (works if TWILIO_ vars are set)
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// ✅ Check for OpenAI key
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY is missing — check Railway Variables.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Test home route
app.get("/", (req, res) => {
  res.send("🚀 HelpFlow AI Server is Running!");
});

// Test OpenAI route
app.get("/test-gpt", async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Say hello!" }],
    });

    res.send(completion.choices[0].message.content);
  } catch (err) {
    console.error("OpenAI Error:", err);
    res.status(500).send("There was an error calling OpenAI.");
  }
});

// ✅ Twilio Webhook Route
app.post("/webhook", (req, res) => {
  console.log("🔔 Incoming webhook from Twilio:", req.body);

  const twiml = `
    <Response>
      <Say voice="alice">Hello! Thanks for calling HelpFlow AI. We'll be in touch shortly.</Say>
    </Response>
  `;

  res.type("text/xml");
  res.send(twiml);
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
