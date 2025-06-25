// client-config.js
export default {
  clients: {
    helpflow: {
      id: "helpflow",
      name: "HelpFlow AI",
      voiceId: "UgBBYS2sOqTuMpoF3BR0", // ElevenLabs “Mark”
      scripts: {
        greeting:
          "Hi! This is HelpFlow AI. How can I help you today?",
        fallback:
          "Sorry, I didn’t catch that. Could you repeat?",
        systemPrompt:
          "You are a friendly, concise phone receptionist for HelpFlow AI. Answer clearly, briefly, and helpfully. If the caller asks about pricing, explain that plans start at $499 per month and ask if they’d like more details.",
      },
    },
  },
};

