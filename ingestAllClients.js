// ingestAllClients.js
// ------------------
// Improved ingestion: fetch all FAQ'S and Scripts records once,
// then filter in JavaScript by clientId to avoid Airtable formula issues.
// Writes out docChunks.json with chunks for each client.
// ------------------
import fs from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import { fetchFromAirtable } from "./utils/airtable.js";

dotenv.config();

const CHUNK_SIZE = 1000;
const OUTPUT_FILE = path.resolve(process.cwd(), "docChunks.json");

// Split text into chunks
function chunkText(text, size = CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

async function ingest() {
  console.log("Fetching all clients, FAQs, and Scripts...");
  const [clients, allFaqs, allScripts] = await Promise.all([
    fetchFromAirtable("Clients"),
    fetchFromAirtable("FAQ'S"),
    fetchFromAirtable("Scripts")
  ]);
  console.log(`Found ${clients.length} clients, ${allFaqs.length} FAQ's, ${allScripts.length} Scripts.`);

  const allChunks = [];

  for (const client of clients) {
    const clientId = client.id;
    const clientName = client["Client Name"] || "Unknown";
    console.log(`\nProcessing ${clientName} (${clientId})`);

    // Filter records in JS
    const faqs = allFaqs.filter(faq => Array.isArray(faq.Client) && faq.Client.includes(clientId));
    const scripts = allScripts.filter(s => Array.isArray(s.Client) && s.Client.includes(clientId));
    console.log(`  - FAQ's: ${faqs.length}, Scripts: ${scripts.length}`);

    // Chunk FAQs
    for (const faq of faqs) {
      const text = faq.Answer || "";
      chunkText(text).forEach((chunk, idx) => {
        allChunks.push({
          clientId,
          clientName,
          source: "FAQ'S",
          recordId: faq.id,
          chunkIndex: idx,
          text: chunk.trim()
        });
      });
    }

    // Chunk Scripts
    for (const script of scripts) {
      const text = script["Script Text"] || "";
      chunkText(text).forEach((chunk, idx) => {
        allChunks.push({
          clientId,
          clientName,
          source: "Script",
          recordId: script.id,
          chunkIndex: idx,
          text: chunk.trim()
        });
      });
    }
  }

  console.log(`\nWriting ${allChunks.length} chunks to ${OUTPUT_FILE}...`);
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(allChunks, null, 2));
  console.log("✅ Ingestion complete!");
}

// run
ingest().catch(err => {
  console.error("Ingestion error:", err);
  process.exit(1);
});
