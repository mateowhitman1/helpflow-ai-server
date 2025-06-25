// client-config.js
export default {
  clients: {
    helpflow: {
      id: "helpflow",
      name: "HelpFlow AI",
      voiceId: "UgBBYS2sOqTuMpoF3BR0", // Your ElevenLabs voice ID
      scripts: {
        greeting: "Hi! This is HelpFlow AI. How can I help you today?",
        fallback: "Sorry, I didn’t catch that. Can you say it again?",
      },
    },
  },
};
