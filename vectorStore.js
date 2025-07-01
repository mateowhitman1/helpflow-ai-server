// vectorStore.js
import fs from 'fs/promises';
import cosineSimilarity from 'cosine-similarity';
import { CHUNKS_PATH, EMBEDS_PATH } from './config.js';

/**
 * Load both chunks and embeddings into memory.
 * @returns {Promise<{ chunks: Array, embeds: Array }>}
 */
export async function loadIndex() {
  try {
    const [chunksRaw, embedsRaw] = await Promise.all([
      fs.readFile(CHUNKS_PATH, 'utf-8'),
      fs.readFile(EMBEDS_PATH, 'utf-8'),
    ]);
    const chunks = JSON.parse(chunksRaw);
    const embeds = JSON.parse(embedsRaw);
    return { chunks, embeds };
  } catch (err) {
    throw new Error(
      `Failed to load index files:\n  Chunks path: ${CHUNKS_PATH}\n  Embeds path: ${EMBEDS_PATH}\n  Error: ${err.message}`
    );
  }
}

/**
 * Given a query embedding, find the top-k nearest chunks.
 * @param {number[]} queryEmbed 
 * @param {number} k 
 */
export async function search(queryEmbed, k = 5) {
  const { chunks, embeds } = await loadIndex();

  // Compute similarity for each embedding
  const sims = embeds.map((item, i) => ({
    index: i,
    score: cosineSimilarity(queryEmbed, item.embedding),
  }));

  // Sort descending by score
  sims.sort((a, b) => b.score - a.score);

  // Return top-k chunk objects + score
  return sims.slice(0, k).map(({ index, score }) => ({
    score,
    chunk: chunks[index],
  }));
}
