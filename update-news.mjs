// scripts/update-news.mjs
//
// Fetches the official Gose City tourism "news" list page and regenerates
// news.json at the repo root. Runs monthly via
// .github/workflows/update-news.yml (GitHub Actions), so the published
// site's "Latest Updates" section stays current without any manual work.
//
// No dependencies beyond Node's built-in fetch (Node 18+) — kept
// deliberately simple so it's easy to read, fork, or point at a different
// source page if the city's site structure ever changes.

import { writeFile, readFile } from "node:fs/promises";

const SOURCE_URL = "https://www.city.gose.nara.jp/kankou/news/0001.html";
const OUTPUT_PATH = new URL("../news.json", import.meta.url);
const MAX_ITEMS = 8;

// Words that show up in navigation/pagination links we want to ignore.
const IGNORE_TITLES = new Set([
  "ホーム", "前へ", "次へ", "前月", "翌月", "検索", "閉じる", "メニュー",
  "サイトポリシー", "サイトマップ", "メールでお問い合わせ",
]);

function toIsoDate(y, m, d) {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function extractItems(html, baseUrl) {
  const items = [];
  const seen = new Set();

  // Matches an <a href="...">title</a>, then looks ahead (within ~150
  // characters, tolerating any intervening tags such as <span>/<dd>/<li>)
  // for a Japanese date like "2026年7月1日".
  const re = /<a[^>]+href="([^"#][^"]*)"[^>]*>([^<]{5,120})<\/a>[\s\S]{0,150}?(\d{4})年(\d{1,2})月(\d{1,2})日/g;

  let match;
  while ((match = re.exec(html)) !== null) {
    const [, href, rawTitle, y, m, d] = match;
    const title = rawTitle.replace(/\s+/g, " ").trim();

    if (!title || IGNORE_TITLES.has(title)) continue;
    if (/^\d+$/.test(title)) continue; // pagination numbers

    let url;
    try {
      url = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    if (seen.has(url)) continue;
    seen.add(url);

    items.push({ date: toIsoDate(y, m, d), title, url });
  }

  items.sort((a, b) => (a.date < b.date ? 1 : -1));
  return items.slice(0, MAX_ITEMS);
}

async function main() {
  let html;
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { "User-Agent": "gose-site-news-bot/1.0 (+static site monthly refresh)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.error("Failed to fetch source page:", err.message);
    console.error("Keeping the existing news.json unchanged.");
    return;
  }

  const items = extractItems(html, SOURCE_URL);

  if (items.length === 0) {
    console.error("No news items could be parsed — the source page's HTML");
    console.error("structure may have changed. Keeping the existing news.json unchanged.");
    return;
  }

  // Sanity check against the previous file so a scraping fluke can't wipe
  // out a perfectly good list.
  try {
    const prevRaw = await readFile(OUTPUT_PATH, "utf8");
    const prev = JSON.parse(prevRaw);
    if (Array.isArray(prev) && prev.length > 0 && items.length < prev.length / 2) {
      console.error("Parsed far fewer items than before — likely a scraping");
      console.error("issue rather than an actual drop in news. Keeping the previous file.");
      return;
    }
  } catch {
    // No previous file, or it wasn't valid JSON — proceed anyway.
  }

  await writeFile(OUTPUT_PATH, JSON.stringify(items, null, 2) + "\n", "utf8");
  console.log(`Wrote ${items.length} items to news.json`);
}

main();
