// Local preview: serves public/ and answers /api/analyze from fixtures (no network).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { onRequestGet } from "../functions/api/analyze.js";
import { onRequestGet as quotesHandler } from "../functions/api/quotes.js";
import { onRequestGet as searchHandler } from "../functions/api/search.js";
import { mockFetch, chain, quote, history, yahoo } from "./fixtures.mjs";
import { scan } from "../scripts/nightly-scan.mjs";
import { SCAN_UNIVERSE } from "../scripts/scan-universe.mjs";

// A sample nightly snapshot with varied made-up prices per ticker (only for the local preview).
function variedFetch() {
  const base = mockFetch();
  const hash = (t) => [...t].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7);
  const tick = (url) => (/\/(?:options|quotes|historical)\/_?([A-Z]+)\.json/.exec(url) || /quoteSummary\/([A-Z.\-]+)/.exec(url) || [])[1];
  const resp = (b) => new Response(JSON.stringify(b));
  return async (url) => {
    url = String(url);
    const t = tick(url);
    if (!t) return base(url);
    const h = hash(t), S = +(8 + (h % 400) * 1.1).toFixed(2), iv = 0.25 + (h % 40) / 100;
    if (url.includes("/options/")) return resp(chain(t, S, iv, { oi: 50 + (h % 900) }));
    if (url.includes("/quotes/")) return resp(quote(S, iv * 100 + (h % 9)));
    if (url.includes("/historical/")) return resp(history(S, 500, 0.0004 + (h % 7) / 4000, iv / 16, h));
    if (url.includes("quoteSummary")) { const y = yahoo(Date.parse("2026-11-0" + (1 + (h % 9)) + "T12:00:00Z") / 1000); const fd = y.quoteSummary.result[0].financialData; fd.targetMeanPrice = { raw: +(S * (1.05 + (h % 30) / 100)).toFixed(2) }; y.quoteSummary.result[0].price.longName = t + " Inc."; return resp(y); }
    return base(url);
  };
}
const sampleSnapshot = JSON.stringify(await scan(SCAN_UNIVERSE, { fetchFn: variedFetch(), log: () => {} }));

globalThis.fetch = mockFetch();
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const h = { "/api/analyze": onRequestGet, "/api/quotes": quotesHandler, "/api/search": searchHandler }[url.pathname];
  if (h) {
    const r = await h({ request: new Request(url), waitUntil() {} });
    res.writeHead(r.status, { "content-type": "application/json" });
    return res.end(await r.text());
  }
  if (url.pathname === "/data/scan.json") { res.writeHead(200, { "content-type": "application/json" }); return res.end(sampleSnapshot); }
  const p = join("public", url.pathname === "/" ? "index.html" : url.pathname);
  try { res.writeHead(200, { "content-type": types[extname(p)] || "text/plain" }); res.end(await readFile(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(process.env.PORT || 8788);
