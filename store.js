import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.env.DATA_DIR || 'data');
const FILE = path.join(DIR, 'articles.json');
fs.mkdirSync(DIR, { recursive: true });   // folder na thakle banabe

let db = { articles: [], seen: [] };

export function load() {
  try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
}
let timer;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, FILE);
    } catch (e) { console.log('⚠ save failed:', e.message); }  // server crash korbe na
  }, 300);
}
export const articles = () => db.articles;
export const hasSeen = (id) => db.seen.includes(id);
export function markSeen(id) {
  db.seen.push(id);
  if (db.seen.length > 5000) db.seen = db.seen.slice(-3000);
  save();
}
export function add(article) { db.articles.unshift(article); if (db.articles.length > 4000) db.articles.length = 4000; save(); }
export function remove(id) { db.articles = db.articles.filter(a => a.id !== id); save(); }