import { CATEGORIES } from './sources.js';

/**
 * AI POOL: ekadhik API key × ekadhik model (+ optional Groq / OpenRouter free fallback).
 * Ekta fail korle auto porerta. Quota shesh hole oi entry ke cooldown e rakhe.
 */
const list = (v, d = '') => (v || d).split(',').map(s => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export class AllExhausted extends Error {
  constructor(retryAt) { super('Shob AI model/key er quota ekhon shesh'); this.retryAt = retryAt; }
}

let pool = null;
function buildPool() {
  const p = [];
  const keys = list(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY);
  const models = list(process.env.GEMINI_MODELS, 'gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash,gemini-2.0-flash-lite');
  // model-first: prothom model er shob key, tarpor porer model
  for (const m of models) keys.forEach((k, i) => p.push({ type: 'gemini', model: m, key: k, label: `gemini:${m}#${i + 1}` }));
  // optional free fallback providers (OpenAI-compatible)
  for (const k of list(process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY))
    for (const m of list(process.env.GROQ_MODELS, 'llama-3.3-70b-versatile,llama-3.1-8b-instant'))
      p.push({ type: 'oai', url: 'https://api.groq.com/openai/v1/chat/completions', model: m, key: k, label: `groq:${m}` });
  for (const k of list(process.env.OPENROUTER_API_KEYS || process.env.OPENROUTER_API_KEY))
    for (const m of list(process.env.OPENROUTER_MODELS, 'meta-llama/llama-3.3-70b-instruct:free,google/gemini-2.0-flash-exp:free'))
      p.push({ type: 'oai', url: 'https://openrouter.ai/api/v1/chat/completions', model: m, key: k, label: `openrouter:${m}` });
  p.forEach(e => { e.until = 0; e.ok = 0; e.fail = 0; e.lastError = ''; });
  return p;
}
export const getPool = () => (pool ??= buildPool());
export const poolStatus = () => getPool().map(e => ({
  label: e.label, ok: e.ok, fail: e.fail,
  state: e.until > Date.now() ? `cooldown ${Math.ceil((e.until - Date.now()) / 60000)}m` : 'ready', lastError: e.lastError
}));

class ApiError extends Error { constructor(status, body) { super(`${status}: ${body.slice(0, 160)}`); this.status = status; this.body = body; } }

async function callEntry(e, prompt) {
  let res;
  if (e.type === 'gemini') {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${e.model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': e.key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, responseMimeType: 'application/json' } }),
      signal: AbortSignal.timeout(60000)
    });
  } else {
    res = await fetch(e.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${e.key}` },
      body: JSON.stringify({ model: e.model, temperature: 0.5, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(60000)
    });
  }
  const raw = await res.text();
  if (!res.ok) throw new ApiError(res.status, raw);
  const data = JSON.parse(raw);
  const text = e.type === 'gemini'
    ? data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('')
    : data?.choices?.[0]?.message?.content;
  if (!text) throw new ApiError(422, 'empty/blocked response');
  return extractJson(text);
}

function extractJson(t) {
  t = t.replace(/```json|```/g, '').trim();
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new ApiError(422, 'bad json');
  return JSON.parse(m[0]);
}

/** Error dekhe ঠিক kore ei entry koto khon rest nibe */
function cooldownFor(err) {
  const s = err.status, b = (err.body || '').toLowerCase();
  if (s === 429) {
    const m = b.match(/"retrydelay":\s*"(\d+)s"/);
    if (/perday|per day|daily|quota exceeded/.test(b) && !(m && +m[1] < 120)) return 6 * 3600e3; // daily quota
    return Math.max(((m ? +m[1] : 60) + 5) * 1000, 30e3);                                         // per-minute limit
  }
  if (s === 404) return 24 * 3600e3;                  // model name nai / deprecated
  if (s === 400 && /api key|api_key/.test(b)) return 24 * 3600e3;
  if (s === 401 || s === 403) return 12 * 3600e3;     // key block / invalid
  if (s >= 500 || s === 408) return 2 * 60e3;         // server problem
  return 0;                                           // 422/json/safety: entry thik, shudhu ei request fail
}

async function generate(prompt) {
  const entries = getPool();
  if (!entries.length) throw new Error('Kono API key set kora nai (.env dekhun)');
  const tried = new Set();
  for (let round = 0; round < entries.length; round++) {
    const e = entries.find(x => !tried.has(x) && x.until <= Date.now());
    if (!e) break;
    tried.add(e);
    try {
      const out = await callEntry(e, prompt);
      e.ok++; e.lastError = '';
      return out;
    } catch (err) {
      e.fail++; e.lastError = String(err.message).slice(0, 120);
      if (err.name === 'TimeoutError' || err.name === 'TypeError') e.until = Date.now() + 60e3; // network
      else e.until = Date.now() + cooldownFor(err);
      console.log(`↪ ${e.label} fail (${e.lastError}) → porer fallback`);
      await sleep(300);
    }
  }
  // kono entry kaj korlo na
  const soonest = Math.min(...entries.map(e => e.until));
  if (soonest > Date.now()) throw new AllExhausted(soonest);
  throw new Error('AI response paoa jay ni (bad output) — item skip');
}

export async function writeArticle({ title, snippet, source, link }) {
  const prompt = `You are the senior editor of a Bangla online news portal.
Rewrite the following news lead into an ORIGINAL, neutral, well-structured Bangla news article.

STRICT RULES:
- Use ONLY facts present in the title/snippet below. Do NOT invent quotes, numbers, names or details.
- If information is thin, write a shorter article (2-3 paragraphs) instead of guessing.
- Do not copy sentences; write in your own words. Natural journalistic Bangla.
- Do not mention "snippet" or "AI".
- Pick exactly one category from: ${CATEGORIES.join(', ')}.
- If the story is unsuitable (adult, graphic violence, spam, ad, or pure rumor), set "skip": true.

SOURCE: ${source}
TITLE: ${title}
SNIPPET: ${snippet}
LINK: ${link}

Return ONLY valid JSON (no markdown):
{
 "skip": false,
 "title": "আকর্ষণীয় কিন্তু ক্লিকবেইট-মুক্ত বাংলা শিরোনাম",
 "summary": "১-২ বাক্যের সারসংক্ষেপ",
 "body": "<p>...</p><p>...</p> (HTML paragraphs, 2-5 টি)",
 "category": "...",
 "tags": ["৩-৫টি ট্যাগ"],
 "keywords_en": ["english seo keywords"],
 "trend_score": 5,
 "image_query": "short english phrase"
}`;
  const r = await generate(prompt);
  if (!CATEGORIES.includes(r.category)) r.category = 'আন্তর্জাতিক';
  return r;
}
