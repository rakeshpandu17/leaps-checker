// Nightly scan: fetches data for every ticker in SCAN_UNIVERSE and writes a compact snapshot to
// public/data/scan.json, which the page uses to rank LEAPS ideas instantly.
// Run: node scripts/nightly-scan.mjs   (GitHub Actions runs it each weekday evening)
import { writeFile, mkdir } from "node:fs/promises";
import { gatherData } from "../functions/_lib/data.js";
import { SCAN_UNIVERSE } from "./scan-universe.mjs";

const OUT = new URL("../public/data/scan.json", import.meta.url);
const CONCURRENCY = 2;
const PAUSE_MS = 400;
const MIN_GAP_MS = 250; // at most ~4 requests a second to any data source
const RETRY_STATUS = new Set([403, 429, 500, 502, 503, 504]);
const r2 = (x) => (x == null ? x : Math.round(x * 100) / 100);
const r4 = (x) => (x == null ? x : Math.round(x * 10000) / 10000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Keep only what the page's scoring needs, to keep the file small.
export function slim(d) {
  const S = d.price;
  const f = d.fundamentals || null;
  return {
    price: r2(S),
    changePct: r2(d.changePct),
    iv30: r2(d.iv30),
    isIndex: d.isIndex,
    asOf: d.asOf,
    lastExpiry: d.lastExpiry,
    earnings: d.earnings,
    fundamentals: f && {
      name: f.name, quoteType: f.quoteType, sector: f.sector, targetMean: r2(f.targetMean),
      revenueGrowth: r4(f.revenueGrowth), profitMargin: r4(f.profitMargin), freeCashflow: f.freeCashflow,
      recommendationMean: r2(f.recommendationMean), recommendationKey: f.recommendationKey, analystCount: f.analystCount,
    },
    closes: d.history.slice(-260).map((h) => r2(h.c)),
    calls: d.calls
      .filter((c) => c.bid > 0 && c.ask > 0 && (!(c.delta > 0) || (c.delta >= 0.6 && c.delta <= 0.97)))
      .map((c) => [c.expiry, c.strike, r2(c.bid), r2(c.ask), r4(c.iv), r4(c.delta), c.oi, c.symbol]),
  };
}

// Wraps fetch so the scan stays under the free sources' rate limits: requests to each host are spaced
// out, and a refused request (rate limit or temporary error) is retried after a growing wait.
export function politeFetch(fetchFn, { gapMs = MIN_GAP_MS, retries = 3, backoffMs = 4000 } = {}) {
  const nextSlot = new Map();
  const stats = { retried: 0, statuses: {} };
  const wrapped = async (url, init) => {
    const host = new URL(String(url)).host;
    for (let attempt = 0; ; attempt++) {
      const now = Date.now();
      const slot = Math.max(now, nextSlot.get(host) || 0);
      nextSlot.set(host, slot + gapMs);
      if (slot > now) await sleep(slot - now);
      const res = await fetchFn(url, init);
      if (!RETRY_STATUS.has(res.status) || attempt >= retries) {
        if (!res.ok) stats.statuses[res.status] = (stats.statuses[res.status] || 0) + 1;
        return res;
      }
      stats.retried++;
      const wait = Number(res.headers.get("retry-after")) * 1000 || backoffMs * 2 ** attempt;
      nextSlot.set(host, Date.now() + wait); // pause the whole host, not just this request
      await sleep(wait);
    }
  };
  wrapped.stats = stats;
  return wrapped;
}

export async function scan(tickers, { fetchFn = fetch, now = new Date(), log = console.log, polite = true } = {}) {
  if (polite) fetchFn = politeFetch(fetchFn);
  const stocks = {};
  const failed = [];
  let i = 0;
  const worker = async () => {
    while (i < tickers.length) {
      const t = tickers[i++];
      try {
        const d = await gatherData(t, { fetchFn, now });
        if (d.ok) stocks[t] = slim(d);
        else failed.push(t);
      } catch (e) {
        failed.push(t);
      }
      await sleep(PAUSE_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`Scanned ${tickers.length}: ${Object.keys(stocks).length} ok, ${failed.length} failed${failed.length ? " (" + failed.join(", ") + ")" : ""}`);
  if (fetchFn.stats) log(`Retries: ${fetchFn.stats.retried}; failed responses by status: ${JSON.stringify(fetchFn.stats.statuses)}`);
  return { generatedAt: now.toISOString(), date: now.toISOString().slice(0, 10), count: Object.keys(stocks).length, failed, stocks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await scan(SCAN_UNIVERSE);
  // Don't replace a good snapshot with a mostly failed one.
  if (result.count < SCAN_UNIVERSE.length * 0.5) {
    console.error("Too many failures; keeping the previous scan.");
    process.exit(1);
  }
  await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify(result));
  console.log(`Wrote ${OUT.pathname}`);
}
