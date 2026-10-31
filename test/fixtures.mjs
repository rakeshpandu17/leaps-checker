// Synthetic payloads shaped like the Cboe / Yahoo / Nasdaq responses, for offline tests.
import { bsCall, bsDelta } from "../public/scoring.js";

export const TODAY = "2026-10-23";

function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

export function history(end = 14.77, days = 500, drift = 0.0012, vol = 0.03, seed = 7) {
  const r = rng(seed);
  const closes = [end];
  for (let i = 1; i < days; i++) {
    const z = (r() + r() + r() - 1.5) * 2;
    closes.unshift(closes[0] / Math.exp(drift + vol * z));
  }
  const start = Date.parse(TODAY + "T00:00:00Z") - days * 1.45 * 86400000;
  return { timestamp: TODAY, data: closes.map((c, i) => ({ date: new Date(start + i * 1.45 * 86400000).toISOString().slice(0, 10), open: c, high: c, low: c, close: +c.toFixed(2), volume: 1e6 })) };
}

export function chain(root = "SOFI", S = 14.77, iv = 0.55, opts = {}) {
  const exps = opts.expiries || ["2026-11-20", "2027-01-15", "2027-06-17", "2027-12-17", "2028-01-21", "2028-12-15"];
  const strikes = opts.strikes || [3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 20, 25, 30];
  const out = [];
  for (const e of exps) {
    const T = (Date.parse(e) - Date.parse(TODAY)) / 86400000 / 365;
    for (const K of strikes) {
      const v = bsCall(S, K, T, iv);
      const half = Math.max(0.03, v * (opts.spread ?? 0.02));
      const code = e.slice(2).replace(/-/g, "") + "C" + String(Math.round(K * 1000)).padStart(8, "0");
      out.push({ option: root + code, bid: +(v - half).toFixed(2), ask: +(v + half).toFixed(2), iv: opts.noGreeks ? 0 : iv, delta: opts.noGreeks ? 0 : +bsDelta(S, K, T, iv).toFixed(4), open_interest: opts.oi ?? 850, volume: 12, last_trade_price: +v.toFixed(2), theta: -0.002, vega: 0.05 });
      out.push({ option: root + code.replace("C", "P"), bid: 0.1, ask: 0.2, iv, delta: -0.2, open_interest: 10 });
    }
  }
  return { timestamp: TODAY + " 16:52:26", data: { options: out } };
}

export const quote = (S = 14.77, iv30 = 57.26) => ({ timestamp: TODAY, data: { symbol: "SOFI", current_price: S, prev_day_close: 14.55, price_change: 0.22, price_change_percent: 1.5, iv30 } });

export const yahoo = (earnTs = Date.parse("2026-10-27T12:00:00Z") / 1000) => ({ quoteSummary: { result: [{
  price: { longName: "SoFi Technologies, Inc.", quoteType: "EQUITY" },
  assetProfile: { sector: "Financial Services", industry: "Credit Services" },
  summaryDetail: { marketCap: { raw: 16.3e9 }, trailingPE: { raw: 38 } },
  defaultKeyStatistics: { forwardPE: { raw: 30 } },
  financialData: { revenueGrowth: { raw: 0.35 }, profitMargins: { raw: 0.12 }, freeCashflow: { raw: 5e8 }, recommendationKey: "hold", recommendationMean: { raw: 2.9 }, numberOfAnalystOpinions: { raw: 18 }, targetMeanPrice: { raw: 15.4 } },
  calendarEvents: { earnings: { earningsDate: [{ raw: earnTs, fmt: "2026-10-27" }] } },
}] } });

// A fetch stand-in that routes URLs to fixtures.
export function mockFetch(over = {}) {
  const routes = {
    options: () => chain(), quotes: () => quote(), historical: () => history(), yahoo: () => yahoo(), nasdaq: () => ({ data: { announcement: "Earnings announcement* for SOFI: Oct 27, 2026" } }), search: () => searchFixture, secTickers: () => null, secSubs: () => null, ...over,
  };
  const resp = (body, status = 200, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  return async (url) => {
    url = String(url);
    const pick = (k) => { const v = routes[k](); return v instanceof Response ? v : v === null ? resp("nope", 404) : resp(v); };
    if (url.includes("/options/")) return pick("options");
    if (url.includes("/quotes/")) return pick("quotes");
    if (url.includes("/historical/")) return pick("historical");
    if (url.includes("fc.yahoo.com")) return resp("", 404, { "set-cookie": "A3=abc; Path=/" });
    if (url.includes("getcrumb")) return resp("crumbXYZ");
    if (url.includes("quoteSummary")) return pick("yahoo");
    if (url.includes("/finance/search")) return pick("search");
    if (url.includes("nasdaq.com")) return pick("nasdaq");
    if (url.includes("sec.gov")) return pick(url.includes("company_tickers") ? "secTickers" : "secSubs");
    return resp("unknown", 404);
  };
}

// Headline times are relative to the tests' fixed "now" (TODAY at 17:00 UTC), so results don't drift with the real date.
const ago = (h) => Math.round(Date.parse(TODAY + "T17:00:00Z") / 1000 - h * 3600);
export const newsFixture = [
  { title: "SoFi Technologies reports record third-quarter results, raises full-year outlook", publisher: "Business Wire", link: "https://example.com/sofi-q3", providerPublishTime: ago(3) },
  { title: "SoFi stock jumps after earnings beat", publisher: "Investor's Business Daily", link: "https://example.com/sofi-jumps", providerPublishTime: ago(2) },
  { title: "Analyst downgrades SoFi to Neutral on valuation", publisher: "Barron's", link: "https://example.com/sofi-down", providerPublishTime: ago(30) },
  { title: "SoFi earnings: what to expect this week", publisher: "Yahoo Finance", link: "https://example.com/sofi-preview", providerPublishTime: ago(72) },
  { title: "Fintech stocks to watch in November", publisher: "Motley Fool", link: "https://example.com/fintech", providerPublishTime: ago(100) },
  { title: "Old story", publisher: "X", link: "https://example.com/old", providerPublishTime: ago(24 * 20) },
];
export const searchFixture = { news: newsFixture, quotes: [
  { symbol: "SOFI", shortname: "SoFi Technologies, Inc.", longname: "SoFi Technologies, Inc.", quoteType: "EQUITY", exchange: "NMS", exchDisp: "NASDAQ" },
  { symbol: "SOFX", shortname: "Defiance Daily Target 2X Long SOFI", quoteType: "ETF", exchange: "NGM", exchDisp: "NASDAQ" },
  { symbol: "SOF.L", shortname: "Some London Listing", quoteType: "EQUITY", exchange: "LSE", exchDisp: "London" },
  { symbol: "SOFIW", shortname: "warrant", quoteType: "WARRANT", exchange: "NMS" },
  { symbol: "BRK-B", shortname: "Berkshire Hathaway Inc. Class B", quoteType: "EQUITY", exchange: "NYQ", exchDisp: "NYSE" },
  { symbol: "^SPX", shortname: "S&P 500", quoteType: "INDEX", exchange: "SNP", exchDisp: "SNP" },
] };
