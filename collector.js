import Parser from 'rss-parser';
import crypto from 'node:crypto';
import { SOURCES } from './sources.js';
import { writeArticle, AllExhausted, poolStatus } from './gemini.js';
import * as store from './store.js';

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AINewsPortal/1.0)' },
  customFields: { item: [['media:content', 'media', { keepArray: false }], ['media:thumbnail', 'thumb']] }
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const strip = (h = '') => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').slice(0, 60);

let running = false;
export const status = { running: false, lastRun: null, lastResult: null, log: [], pool: [] };
const log = (m) => { console.log(m); status.log.unshift(`${new Date().toLocaleTimeString()} ${m}`); status.log.length = Math.min(status.log.length, 60); };

function imageOf(item) {
  return item.media?.$?.url || item.thumb?.$?.url || item.enclosure?.url ||
    (item.content || item['content:encoded'] || '').match(/<img[^>]+src="([^"]+)"/)?.[1] || null;
}

async function gather() {
  const out = [];
  await Promise.all(SOURCES.map(async (src) => {
    try {
      const feed = await parser.parseURL(src.url);
      feed.items.slice(0, 15).forEach((it, i) => {
        if (!it.title || !it.link) return;
        out.push({
          id: hash(it.link), title: it.title.replace(/ - [^-]+$/, ''), link: it.link,
          snippet: strip(it.contentSnippet || it.content || it.summary || '').slice(0, 900),
          source: src.name, lang: src.lang, image: imageOf(it), rank: i,
          date: it.isoDate || new Date().toISOString()
        });
      });
    } catch (e) { log(`⚠ ${src.name}: ${e.message}`); }
  }));
  return out;
}

/** AI na thakle: original headline + short snippet + source link diye "সংক্ষেপে" post (optional) */
function rawFallback(items) {
  let n = 0;
  for (const it of items) {
    if (!it.snippet || it.snippet.length < 60) continue;
    store.markSeen(it.id);
    store.add({
      id: it.id, slug: it.id, title: it.title, summary: it.snippet.slice(0, 160),
      body: `<p>${it.snippet.replace(/[<>]/g, '')}</p>`, category: it.lang === 'bn' ? 'বাংলাদেশ' : 'আন্তর্জাতিক',
      tags: [], keywords: [], trend: 3, image: it.image, source: it.source, sourceUrl: it.link, sourceTitle: it.title,
      published: process.env.AUTO_PUBLISH !== 'false', views: 0, createdAt: new Date().toISOString(), sourceDate: it.date, raw: true
    });
    n++;
  }
  if (n) log(`📰 AI chara ${n} ta "সংক্ষেপে" post dewa holo`);
  return n;
}

export async function runCollector() {
  if (running) return { skipped: true };
  if (!poolStatus().length) { log('❌ Kono API key set kora nai (.env dekhun)'); return { error: 'no key' }; }
  running = true; status.running = true;
  const max = +process.env.MAX_PER_RUN || 8;
  const delay = +process.env.GEMINI_DELAY_MS || 7000;
  let made = 0;
  try {
    const items = await gather();
    log(`📡 ${items.length} ta item pawa gelo`);
    const existingTitles = new Set(store.articles().map(a => norm(a.sourceTitle || '')));
    // jegulo sobar upore (rank kom) ar notun, segulo age
    const fresh = items
      .filter(i => !store.hasSeen(i.id) && !existingTitles.has(norm(i.title)))
      .sort((a, b) => a.rank - b.rank);
    // ekoi title duplicate bad
    const uniq = []; const keys = new Set();
    for (const i of fresh) { const k = norm(i.title); if (!keys.has(k)) { keys.add(k); uniq.push(i); } }

    for (const item of uniq.slice(0, max)) {
      try {
        const r = await writeArticle(item);
        store.markSeen(item.id);
        if (r.skip || !r.title || !r.body) { log(`⏭ skip: ${item.title.slice(0, 40)}`); }
        else {
          const slug = `${item.id}`;
          store.add({
            id: item.id, slug, title: r.title, summary: r.summary, body: r.body,
            category: r.category, tags: r.tags || [], keywords: r.keywords_en || [],
            trend: Math.min(10, Math.max(1, +r.trend_score || 5)),
            image: item.image, imageQuery: r.image_query,
            source: item.source, sourceUrl: item.link, sourceTitle: item.title,
            published: process.env.AUTO_PUBLISH !== 'false',
            views: 0, createdAt: new Date().toISOString(), sourceDate: item.date
          });
          made++; log(`✅ ${r.title.slice(0, 50)}`);
        }
      } catch (e) {
        if (e instanceof AllExhausted) {
          const mins = Math.max(1, Math.ceil((e.retryAt - Date.now()) / 60000));
          log(`⏸ Shob AI quota shesh. ~${mins} min por abar try hobe. Baki news hariye jayni, porer run e hobe.`);
          if (process.env.RAW_FALLBACK === 'true') made += rawFallback(uniq.filter(i => !store.hasSeen(i.id)).slice(0, 5));
          break;
        }
        log(`❌ ${item.title.slice(0, 35)}: ${e.message}`);
        item.failures = (item.failures || 0) + 1;
        // ekoi item bar bar fail korle (bad output) tokhon skip kore dei
        if (/bad output|bad json|blocked/i.test(e.message)) store.markSeen(item.id);
      }
      await sleep(delay);
    }
  } finally {
    running = false; status.running = false;
    status.lastRun = new Date().toISOString(); status.lastResult = { made }; status.pool = poolStatus();
  }
  return { made };
}
