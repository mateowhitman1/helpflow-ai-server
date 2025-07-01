// testSearchLocal.js
import { loadIndex, search } from './vectorStore.js';

async function runTest() {
  // 1. Load your chunks & embeddings
  const { chunks, embeds } = await loadIndex();
  console.log(`Loaded ${chunks.length} chunks and ${embeds.length} embeddings.`);

  if (embeds.length === 0) {
    console.error('❌ No embeddings to search against.');
    process.exit(1);
  }

  // 2. Pick a sample embedding (we’ll search it against itself)
  const sampleEmbed = embeds[0].embedding;
  console.log('Using chunk #0 as a sample query:', chunks[0].text?.slice(0, 80));

  // 3. Run your search()
  const results = await search(sampleEmbed, 3);
  console.log('\n🔍 Top 3 matches:');
  results.forEach(({ score, chunk }, i) => {
    console.log(`\nResult ${i + 1} (score: ${score.toFixed(4)}):`);
    console.log(chunk.text || JSON.stringify(chunk).slice(0, 200));
  });
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
