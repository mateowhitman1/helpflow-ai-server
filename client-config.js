import Airtable from 'airtable';
import { LRUCache } from 'lru-cache';
import dotenv from 'dotenv';
import Ajv from 'ajv';

dotenv.config();
const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME, CONFIG_CACHE_TTL_MS } = process.env;

// JSON schema for client config fields, allowing numeric strings
const schema = {
  type: 'object',
  properties: {
    ClientID: { type: 'string' },
    BotName: { type: 'string' },
    VoiceId: { type: 'string' },
    SystemPrompt: { type: 'string' },
    GatherTimeout: { anyOf: [{ type: 'number' }, { type: 'string' }] },
    MaxRetries: { anyOf: [{ type: 'number' }, { type: 'string' }] },
    DataSources: { type: 'string' },
    ModelId: { type: 'string' },    // new field for ElevenLabs TTS model
  },
  required: ['ClientID', 'BotName', 'VoiceId', 'SystemPrompt'],
  additionalProperties: true,
};

const ajv = new Ajv({ coerceTypes: true });
const validate = ajv.compile(schema);

// Default fallback values
const defaultConfig = {
  clientId: '',
   maxTokens: 60,
  topK: 2,

  // core defaults if Airtable isn’t populated
  botName: 'HelpFlow AI',
  voiceId: process.env.ELEVENLABS_VOICE_ID || 'agent_01jyj7d6acepza3vek18fnjhfz',
  systemPrompt:
    'You are a friendly, concise phone receptionist for HelpFlow AI. Answer clearly, briefly, and helpfully.',
  modelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_turbo_v2', // default TTS model
  gatherTimeout: 6,
  maxRetries: 2,
  dataSources: [],
};

// Initialize Airtable
let base;
if (AIRTABLE_API_KEY && AIRTABLE_BASE_ID && AIRTABLE_TABLE_NAME) {
  Airtable.configure({ apiKey: AIRTABLE_API_KEY });
  base = Airtable.base(AIRTABLE_BASE_ID);
} else {
  console.warn('Airtable not fully configured; using defaults only');
}

// Cache for configs
const cache = new LRUCache({ max: 100, ttl: CONFIG_CACHE_TTL_MS ? Number(CONFIG_CACHE_TTL_MS) : 1000 * 60 * 5 });
let cacheHits = 0, cacheMisses = 0;

export function getCacheMetrics() {
  return { hits: cacheHits, misses: cacheMisses, size: cache.size };
}
export function registerMetricsEndpoint(app, path = '/config-metrics') {
  app.get(path, (req, res) => res.json(getCacheMetrics()));
}

/**
 * Fetch client config by ID, with Airtable lookup and fallback.
 */
export async function getClientConfig(clientId) {
  const key = clientId.toLowerCase();
  if (cache.has(key)) {
    cacheHits++;
    return cache.get(key);
  }
  cacheMisses++;

  // start with defaults
  let config = { clientId, ...defaultConfig };

  if (base) {
    try {
      // pull up to 100 records
      const records = await base(AIRTABLE_TABLE_NAME).select({ maxRecords: 100 }).firstPage();
      // detect primary field
      const primaryField = Object.keys(records[0].fields)[0];
      console.log(`→ Detected primary field: ${primaryField}`);
      const record = records.find(r =>
        String(r.fields[primaryField] || '').toLowerCase() === clientId.toLowerCase()
      );
      if (record) {
        const f = record.fields;
        console.log('⚙️  Record fields:', f);
        if (!validate(f)) {
          const errs = validate.errors.map(e => `${e.instancePath} ${e.message}`).join(', ');
          throw new Error(`Invalid config for '${clientId}': ${errs}`);
        }
        // parse dataSources
        let dataSources = defaultConfig.dataSources;
        if (f.DataSources) {
          try { dataSources = JSON.parse(f.DataSources); } catch { console.warn(`Bad JSON DataSources for ${clientId}`); }
        }
        config = {
          clientId,
          botName: f.BotName,
          voiceId: f.VoiceId,
          systemPrompt: f.SystemPrompt,
          modelId: f.ModelId || defaultConfig.modelId, // include client-specific or default
          gatherTimeout: Number(f.GatherTimeout) || defaultConfig.gatherTimeout,
          maxRetries: Number(f.MaxRetries) || defaultConfig.maxRetries,
          dataSources,
        };
      }
    } catch (err) {
      console.error(`Error loading config for ${clientId}:`, err);
    }
  }

  cache.set(key, config);
  return config;
}
