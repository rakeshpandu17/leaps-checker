// Nightly scan: fetches data for every ticker in SCAN_UNIVERSE and writes a compact snapshot to
// public/data/scan.json, which the page uses to rank LEAPS ideas instantly.
// Run: node scripts/nightly-scan.mjs   (GitHub Actions runs it each weekday evening)
import { writeFile, mkdir } from "node:fs/promises";
import { gatherData } from "../functions/_lib/data.js";
import { SCAN_UNIVERSE } from "./scan-universe.mjs";

const OUT = new URL("../public/data/scan.json", import.meta.url);
const CONCURRENCY = 4;
const PAUSE_MS = 150;
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

export async function scan(tickers, { fetchFn = fetch, now = new Date(), log = console.log } = {}) {
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
