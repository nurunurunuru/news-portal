import express from 'express';
import cron from 'node-cron';
import * as store from './store.js';
import { runCollector, status } from './collector.js';
import { poolStatus } from './gemini.js';
import { CATEGORIES } from './sources.js';

store.load();
const app = express();
app.use(express.json());
app.use(express.static('public'));

const SITE = () => process.env.SITE_NAME || 'Khobor AI';
const URL_ = () => (process.env.SITE_URL || '').replace(/\/$/, '');
const esc = (s = '') => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const pub = () => store.articles().filter(a => a.published);
const card = ({ body, ...rest }) => rest;
const admin = (req, res, next) =>
  req.get('x-admin-key') === process.env.ADMIN_KEY ? next() : res.status(401).json({ error: 'unauthorized' });

// Trending: AI score + views + recency
const heat = (a) => {
  const hrs = (Date.now() - new Date(a.createdAt)) / 36e5;
  return (a.trend * 10 + Math.log2(a.views + 1) * 6) / Math.pow(hrs + 2, 0.6);
};

app.get('/api/config', (_, res) => res.json({ name: SITE(), categories: CATEGORIES }));

app.get('/api/articles', (req, res) => {
  const { category, q, tag, page = 1, limit = 12 } = req.query;
  let list = pub();
  if (category) list = list.filter(a => a.category === category);
  if (tag) list = list.filter(a => a.tags.includes(tag));
  if (q) { const s = q.toLowerCase(); list = list.filter(a => (a.title + a.summary + a.tags.join(' ')).toLowerCase().includes(s)); }
  const start = (page - 1) * limit;
  res.json({ total: list.length, items: list.slice(start, start + +limit).map(card) });
});

app.get('/api/trending', (_, res) =>
  res.json(pub().filter(a => Date.now() - new Date(a.createdAt) < 72 * 36e5).sort((a, b) => heat(b) - heat(a)).slice(0, 8).map(card)));

app.get('/api/articles/:slug', (req, res) => {
  const a = pub().find(x => x.slug === req.params.slug);
  if (!a) return res.status(404).json({ error: 'not found' });
  a.views++; store.save();
  const related = pub().filter(x => x.id !== a.id && x.category === a.category).slice(0, 4).map(card);
  res.json({ ...a, related });
});

// ---------- Admin ----------
app.get('/api/admin/all', admin, (_, res) => res.json({ status: { ...status, pool: poolStatus() }, items: store.articles().map(card) }));
app.post('/api/admin/run', admin, (_, res) => { runCollector(); res.json({ started: true }); });
app.patch('/api/admin/:id', admin, (req, res) => {
  const a = store.articles().find(x => x.id === req.params.id);
  if (!a) return res.sendStatus(404);
  Object.assign(a, ['published', 'title', 'summary', 'body', 'category'].reduce((o, k) => (k in req.body ? { ...o, [k]: req.body[k] } : o), {}));
  store.save(); res.json({ ok: true });
});
app.delete('/api/admin/:id', admin, (req, res) => { store.remove(req.params.id); res.json({ ok: true }); });

// ---------- SEO ----------
app.get('/sitemap.xml', (_, res) => {
  res.type('xml').send(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    pub().slice(0, 1000).map(a => `<url><loc>${URL_()}/#/news/${a.slug}</loc><lastmod>${a.createdAt}</lastmod></url>`).join('') + `</urlset>`);
});
app.get('/rss.xml', (_, res) => {
  res.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(SITE())}</title><link>${URL_()}</link><description>Latest news</description>` +
    pub().slice(0, 40).map(a => `<item><title>${esc(a.title)}</title><link>${URL_()}/#/news/${a.slug}</link><description>${esc(a.summary)}</description><pubDate>${new Date(a.createdAt).toUTCString()}</pubDate></item>`).join('') + `</channel></rss>`);
});

// ---------- Scheduler ----------
const every = Math.max(5, +process.env.FETCH_EVERY_MINUTES || 30);
cron.schedule(`*/${every} * * * *`, () => runCollector());
setTimeout(() => runCollector(), 3000); // server chalu hole prothom run

app.listen(process.env.PORT || 3000, () => console.log(`🚀 ${SITE()} → http://localhost:${process.env.PORT || 3000}  (auto-fetch every ${every} min)`));
