// scripts/index-kb.js
// Usage: node scripts/index-kb.js <clientId>

import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';
import { makeVectorStore } from '../vectorStore.js';
import dotenv from 'dotenv';

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Simple chunker: split by sentences (~500 words)
function splitIntoChunks(text, maxWords = 500) {
  const sentences = text.split(/(?<=[.?!])\s+/);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).split(' ').length > maxWords) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += ' ' + sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

async function indexClient(clientId) {
  console.log(`Working directory: ${process.cwd()}`);
  const kbDir = path.join(process.cwd(), 'knowledge_base', clientId);
  console.log(`Looking for KB directory at: ${kbDir}`);
  try {
    const stat = await fs.promises.stat(kbDir);
    console.log(`KB directory stats: ${JSON.stringify(stat)}`);
  } catch (statErr) {
    console.error(`Cannot access directory ${kbDir}:`, statErr.message);
    return;
  }

  console.log(`Indexing KB for client: ${clientId}`);
  let files;
  try {
    files = await fs.promises.readdir(kbDir);
  } catch (err) {
    console.error(`Directory not found for client '${clientId}' at ${kbDir}`);
    return;
  }
  console.log(`  Found files in ${kbDir}: ${files.join(', ')}`);
  const vs = makeVectorStore(clientId);

  for (const file of files.filter(f => /\.(txt|md)$/i.test(f))) {
    const filePath = path.join(kbDir, file);
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const chunks = splitIntoChunks(content);
    console.log(`  File ${file}: ${chunks.length} chunks`);
    for (const chunk of chunks) {
      const embRes = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: chunk,
      });
      await vs.upsertChunk({
        embedding: embRes.data[0].embedding,
        metadata: { source: file, text: chunk },
      });
    }
  }

  console.log('✅ Completed indexing for', clientId);
}

(async () => {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node scripts/index-kb.js <clientId>');
    process.exit(1);
  }
  const clientId = args[0];
  try {
    await indexClient(clientId);
  } catch (err) {
    console.error('Indexing failed:', err);
    process.exit(1);
  }
})();
