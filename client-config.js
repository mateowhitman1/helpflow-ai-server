// client-config.js
import Airtable from 'airtable';
import { LRUCache } from 'lru-cache';
import dotenv from 'dotenv';
import Ajv from 'ajv';

dotenv.config();
const {
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  TABLE_SCRIPTS,
  TABLE_VOICES,
  TABLE_UPSELLS,
  TABLE_SETTINGS,
  TABLE_KB,
  CONFIG_CACHE_TTL_MS,
  ELEVENLABS_VOICE_ID,
  ELEVENLABS_MODEL_ID
} = process.env;

// JSON schema for client config fields (if using validation for main table)
const schema = {
  type: 'object',
  properties: {
    ClientID: { type: 'string' },
    BotName: { type: 'string' },
    VoiceId: { type: 'string' },
    SystemPrompt: { type: 'string' }
    // add other core fields as needed
  },
  required: ['ClientID', 'BotName', 'VoiceId', 'SystemPrompt'],
  additionalProperties: true
};

const ajv = new Ajv({ coerceTypes: true });
const validate = ajv.compile(schema);

// Default fallback values
const defaultConfig = {
  clientId: '',
  botName: 'HelpFlow AI',
  voiceId: ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL',
  systemPrompt:
    'You are a friendly, concise phone receptionist for HelpFlow AI. Answer clearly, briefly, and helpfully.',
  modelId: ELEVENLABS_MODEL_ID || 'eleven_turbo_v2',
  gatherTimeout: 6,
  maxRetries: 2,
  dataSources: [],
  scripts: {},
  voices: {},
  upsells: [],
  settings: {},
  knowledgeBase: []
};

// Initialize Airtable
let base;
if (AIRTABLE_API_KEY && AIRTABLE_BASE_ID) {
  Airtable.configure({ apiKey: AIRTABLE_API_KEY });
  base = Airtable.base(AIRTABLE_BASE_ID);
} else {
  console.warn('Airtable not fully configured; using defaults only');
}

// Cache for configs
const cache = new LRUCache({
  max: 100,
  ttl: CONFIG_CACHE_TTL_MS ? Number(CONFIG_CACHE_TTL_MS) : 1000 * 60 * 5
});
let cacheHits = 0;
let cacheMisses = 0;

/**
 * Returns cache statistics.
 */
export function getCacheMetrics() {
  return { hits: cacheHits, misses: cacheMisses, size: cache.size };
}

/**
 * Register an Express endpoint to expose cache metrics.
 */
export function registerMetricsEndpoint(app, path = '/config-metrics') {
  app.get(path, (req, res) => res.json(getCacheMetrics()));
}

/**
 * Fetch all records from an Airtable table with optional filter formula.
 */
async function fetchAll(tableName, filterFormula = '') {
  const out = [];
  if (!base) return out;
  await base(tableName)
    .select({ filterByFormula: filterFormula, pageSize: 100 })
    .eachPage((page, next) => {
      out.push(...page.map(r => ({ id: r.id, fields: r.fields })));
      next();
    });
  return out;
}

/**
 * Load client configuration from multiple Airtable tables, with caching.
 */
export async function getClientConfig(clientId) {
  const key = clientId.toLowerCase();
  if (cache.has(key)) {
    cacheHits++;
    return cache.get(key);
  }
  cacheMisses++;

  // Start with defaults
  let config = { clientId, ...defaultConfig };

  if (base) {
    try {
      const [
        scripts,
        voices,
        upsells,
        settings,
        kbEntries
      ] = await Promise.all([
        fetchAll(TABLE_SCRIPTS, `{clientId}="${clientId}"`),
        fetchAll(TABLE_VOICES, `{clientId}="${clientId}"`),
        fetchAll(TABLE_UPSELLS, `{clientId}="${clientId}"`),
        fetchAll(TABLE_SETTINGS, `{clientId}="${clientId}"`),
        fetchAll(TABLE_KB, `OR({clientId}="${clientId}", {clientId}="")`)
      ]);

      const scriptMap = Object.fromEntries(
        scripts.map(r => [r.fields['Step Name'], r.fields.scriptText])
      );

      const voiceMap = Object.fromEntries(
        voices.map(r => [r.fields['Voice Name'], { voiceId: r.fields.voiceId, model: r.fields.model }])
      );

      const upsellList = upsells
        .filter(r => r.fields.enabled === 'Yes')
        .map(r => r.fields['Option Name']);

      const settingsMap = Object.fromEntries(
        settings.map(r => [r.fields.Key, r.fields.value])
      );

      const kb = kbEntries.map(r => ({ key: r.fields['Topic Key'], content: r.fields.content }));

      config = {
        ...config,
        scripts: scriptMap,
        voices: voiceMap,
        upsells: upsellList,
        settings: settingsMap,
        knowledgeBase: kb
      };
    } catch (err) {
      console.error(`Error loading config for ${clientId}:`, err);
    }
  }

  cache.set(key, config);
  return config;
}
