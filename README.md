# Khobor AI – স্বয়ংক্রিয় এআই নিউজ পোর্টাল

**কীভাবে কাজ করে:** RSS সোর্স (BBC Bangla, Google News, HN, Reddit…) → ডুপ্লিকেট বাদ → Gemini (ফ্রি API) দিয়ে অরিজিনাল বাংলা আর্টিকল, ক্যাটাগরি, ট্যাগ, ট্রেন্ড-স্কোর → স্বয়ংক্রিয় পাবলিশ → ওয়েবসাইটে লাইভ।

## চালানোর নিয়ম
1. Node.js 20.6+ ইনস্টল করুন
2. https://aistudio.google.com/apikey থেকে ফ্রি Gemini key নিন
3. ```
   cp .env.example .env     # key ও ADMIN_KEY বসান
   npm install
   npm start
   ```
4. http://localhost:3000 — অ্যাডমিন: http://localhost:3000/#/admin

## ফিচার
- প্রতি N মিনিটে অটো-ফেচ (cron), Gemini free rate-limit অনুযায়ী ধীরে প্রসেসিং + 429 retry
- ট্রেন্ডিং অ্যালগরিদম (AI স্কোর + ভিউ + সময়)
- ক্যাটাগরি, ট্যাগ, সার্চ, ডার্ক মোড, লাইভ টিকার, রিলেটেড নিউজ
- অ্যাডমিন প্যানেল: ম্যানুয়াল রান, লাইভ লগ, পাবলিশ/আনপাবলিশ/ডিলিট
- `AUTO_PUBLISH=false` দিলে খবর ড্রাফট হবে, আপনি অ্যাপ্রুভ করবেন
- `/rss.xml` ও `/sitemap.xml` (SEO)

## সোর্স বদলাতে: `sources.js` এডিট করুন।

## Production
- VPS/Render/Railway-তে ডেপ্লয় করুন, `pm2 start server.js --node-args="--env-file=.env"`
- Nginx + HTTPS, `SITE_URL` সেট করুন
- ট্রাফিক বাড়লে `data/articles.json` এর বদলে SQLite/PostgreSQL ব্যবহার করুন

## আইনি সতর্কতা
সোর্সের লেখা হুবহু কপি করা হয় না; AI নিজের ভাষায় পুনর্লিখন করে এবং মূল সূত্রের লিংক দেখায়। তবুও বাণিজ্যিকভাবে চালানোর আগে প্রতিটি সোর্সের ব্যবহারের শর্ত (ToS) দেখে নিন।
