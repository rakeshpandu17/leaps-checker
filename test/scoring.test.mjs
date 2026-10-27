import { test } from "node:test";
import assert from "node:assert/strict";
import { gatherData, parseOccSymbol, cleanTicker, cboeSymbol, parseNasdaqEarnings } from "../functions/_lib/data.js";
import { analyze, impliedVol, bsCall } from "../public/scoring.js";
import { TODAY, mockFetch, chain, history, yahoo } from "./fixtures.mjs";

const now = new Date(TODAY + "T17:00:00Z");
const get = (over, t = "SOFI") => gatherData(t, { fetchFn: mockFetch(over), now });

test("parses OCC symbols and tickers", () => {
  assert.deepEqual(parseOccSymbol("SOFI271217C00010000"), { root: "SOFI", expiry: "2027-12-17", type: "C", strike: 10 });
  assert.equal(parseOccSymbol("SPXW281215C05500000").strike, 5500);
  assert.equal(cleanTicker(" brk.b "), "BRK.B");
  assert.equal(cleanTicker("<script>"), null);
  assert.equal(cboeSymbol("SPX"), "_SPX");
  assert.equal(cboeSymbol("BRK.B"), "BRKB");
  assert.equal(parseNasdaqEarnings({ data: { announcement: "Earnings announcement* for SOFI: Oct 27, 2026" } }, TODAY), "2026-10-27");
});

test("implied vol round-trips", () => {
  const p = bsCall(15, 10, 1.2, 0.5);
  assert.ok(Math.abs(impliedVol(p, 15, 10, 1.2) - 0.5) < 1e-3);
});

test("gathers and normalizes data", async () => {
  const d = await get();
  assert.equal(d.ok, true);
  assert.equal(d.price, 14.77);
  assert.equal(d.iv30, 57.26);
  assert.equal(d.earnings.date, "2026-10-27");
  assert.ok(d.calls.every((c) => c.dte >= 240));
  assert.ok(d.calls.length > 20);
  assert.equal(d.fundamentals.name, "SoFi Technologies, Inc.");
});

test("SOFI before earnings: WAIT with a deep ITM LEAPS picked", async () => {
  const a = analyze(await get());
  assert.equal(a.verdict.level, "wait", JSON.stringify(a.verdict));
  assert.ok(a.best.delta >= 0.7 && a.best.delta <= 0.9);
  assert.ok(a.best.dte >= 365);
  assert.equal(a.checks.length, 8);
  assert.equal(a.checks[3].earnState, "fail");
  console.log("best:", a.best.symbol, a.best.mid.toFixed(2), a.best.delta.toFixed(2), a.best.breakevenPct.toFixed(1) + "%");
  console.log("verdict:", a.verdict);
  console.log(a.checks.map((c) => `${c.id} ${c.state} ${c.summary}`).join("\n"));
});

test("earnings time of day from Yahoo's timestamp", async () => {
  const { earningsWhen } = await import("../functions/_lib/data.js");
  assert.deepEqual(earningsWhen(Date.parse("2026-10-27T11:00:00Z") / 1000), { date: "2026-10-27", timing: "before-open" });
  assert.deepEqual(earningsWhen(Date.parse("2026-10-27T20:05:00Z") / 1000), { date: "2026-10-27", timing: "after-close" });
  assert.deepEqual(earningsWhen(Date.parse("2026-10-28T01:00:00Z") / 1000), { date: "2026-10-27", timing: "after-close" });
  assert.deepEqual(earningsWhen(Date.parse("2026-10-27T00:00:00Z") / 1000), { date: "2026-10-27", timing: null });
  assert.equal(earningsWhen(Date.parse("2026-10-27T11:00:00Z") / 1000, true).timing, null);
});

test("earnings today: reported before the open doesn't wait; after the close or unknown time does", async () => {
  const base = await get();
  const at = (timing) => analyze({ ...base, today: "2026-10-27", earnings: { date: "2026-10-27", timing, source: "Yahoo Finance" } });
  const pre = at("before-open"), post = at("after-close"), unk = at(null);
  assert.equal(pre.checks[3].earnState, "pass");
  assert.ok(!pre.verdict.reasons.some((r) => /Earnings/.test(r)), JSON.stringify(pre.verdict));
  assert.equal(post.checks[3].earnState, "fail");
  assert.equal(post.verdict.level, "wait");
  assert.equal(unk.checks[3].earnState, "warn");
  assert.match(unk.checks[3].summary, /today/);
});

test("news: tags headlines, drops old ones, flags risk in the stock check", async () => {
  const { tagHeadline } = await import("../functions/_lib/data.js");
  assert.deepEqual(tagHeadline("SoFi reports third-quarter results"), ["results"]);
  assert.deepEqual(tagHeadline("SoFi earnings: what to expect"), []);
  assert.deepEqual(tagHeadline("Analyst downgrades SoFi to Neutral"), ["risk"]);
  assert.deepEqual(tagHeadline("SoFi stock jumps after earnings beat"), ["results", "positive"]);
  const d = await get();
  assert.equal(d.news.length, 5);
  assert.ok(d.news[0].time >= d.news[1].time);
  const a = analyze(d);
  assert.equal(a.checks[5].state, "warn");
  assert.ok(a.checks[5].details.some((x) => /downgrades/.test(x)));
});

test("calm IV, earnings far away, uptrend: GO", async () => {
  const far = Date.parse("2027-01-28T12:00:00Z") / 1000;
  const d = await get({ yahoo: () => yahoo(far), options: () => chain("SOFI", 14.77, 0.42), quotes: () => ({ data: { current_price: 14.77, iv30: 40 } }), historical: () => history(14.77, 500, 0.0012, 0.028) });
  const a = analyze(d, { portfolio: 50000 });
  console.log("GO case:", a.verdict, "ivratio", a.ivc.ratio?.toFixed(2));
  assert.equal(a.verdict.level, "go");
  assert.equal(a.checks[6].state, "pass");
});

test("no LEAPS listed: NO-GO", async () => {
  const d = await get({ options: () => chain("XYZ", 14.77, 0.5, { expiries: ["2026-11-20", "2027-01-15"] }) });
  const a = analyze(d);
  assert.equal(a.best, null);
  assert.equal(a.verdict.level, "nogo");
});

test("illiquid chain: NO-GO", async () => {
  const d = await get({ options: () => chain("SOFI", 14.77, 0.5, { spread: 0.12, oi: 5 }) });
  assert.equal(analyze(d).verdict.level, "nogo");
});

test("missing Greeks are computed from prices", async () => {
  const d = await get({ options: () => chain("SOFI", 14.77, 0.5, { noGreeks: true }) });
  const a = analyze(d);
  assert.ok(a.best.computedGreeks);
  assert.ok(a.best.delta > 0.7);
});

test("unknown ticker / mutual fund gives a clear error", async () => {
  const d = await get({ options: () => null }, "VFIAX");
  assert.equal(d.ok, false);
  assert.match(d.error, /No listed options/);
});

test("Yahoo down still works, earnings from Nasdaq", async () => {
  const d = await get({ yahoo: () => new Response("x", { status: 401 }) });
  assert.equal(d.ok, true);
  assert.equal(d.fundamentals, null);
  assert.equal(d.earnings.source, "Nasdaq");
  analyze(d);
});

test("budget limits the contract and projection ranks it", async () => {
  const d = await get();
  const free = analyze(d);
  const capped = analyze(d, { maxCost: 450 });
  assert.ok(capped.best.mid * 100 <= 450, `cost ${capped.best.mid * 100}`);
  assert.notEqual(capped.best.symbol, free.best.symbol);
  assert.equal(capped.projection.basis, "analyst target");
  assert.ok(isFinite(capped.projection.annualized));
  const tooSmall = analyze(d, { maxCost: 50 });
  assert.equal(tooSmall.best, null);
  assert.equal(tooSmall.overBudget, true);
});

test("batch quotes", async () => {
  const { gatherQuotes } = await import("../functions/_lib/data.js");
  const r = await gatherQuotes(["sofi", "AAPL", "bad ticker!"], { fetchFn: mockFetch() });
  assert.deepEqual(Object.keys(r.quotes), ["SOFI", "AAPL"]);
  assert.equal(r.quotes.SOFI.price, 14.77);
});

test("ticker search keeps US stocks, ETFs and indexes", async () => {
  const { searchTickers } = await import("../functions/_lib/data.js");
  const r = await searchTickers("sof", { fetchFn: mockFetch() });
  assert.deepEqual(r.results.map((x) => x.symbol), ["SOFI", "SOFX", "BRK.B", "SPX"]);
  assert.equal(r.results[0].name, "SoFi Technologies, Inc.");
  assert.equal(r.results[0].type, "Stock");
});

test("nightly scan snapshot round-trips to the same contract", async () => {
  const { scan } = await import("../scripts/nightly-scan.mjs");
  const { fromSnapshot } = await import("../public/snapshot.js");
  const snap = await scan(["SOFI"], { fetchFn: mockFetch({ options: () => chain() }), now, log: () => {}, polite: false });
  assert.equal(snap.count, 1);
  const live = await get();
  const d = fromSnapshot("SOFI", JSON.parse(JSON.stringify(snap.stocks.SOFI)), TODAY);
  const a1 = analyze(live, { maxCost: 600 }), a2 = analyze(d, { maxCost: 600 });
  assert.equal(a2.best.symbol, a1.best.symbol);
  assert.equal(a2.verdict.level, a1.verdict.level);
  assert.ok(JSON.stringify(snap).length < 40000, "snapshot per stock stays small");
});

test("polite fetch retries a rate-limited request", async () => {
  const { politeFetch } = await import("../scripts/nightly-scan.mjs");
  let calls = 0;
  const flaky = async () => (++calls < 3 ? new Response("slow down", { status: 429 }) : new Response("{}", { status: 200 }));
  const f = politeFetch(flaky, { gapMs: 1, backoffMs: 5 });
  const r = await f("https://cdn.cboe.com/x.json");
  assert.equal(r.status, 200);
  assert.equal(calls, 3);
  assert.equal(f.stats.retried, 2);
});

test("scan can fetch through the site's own API", async () => {
  const { scan } = await import("../scripts/nightly-scan.mjs");
  const { onRequestGet } = await import("../functions/api/analyze.js");
  const inner = mockFetch();
  const prev = globalThis.fetch;
  globalThis.fetch = inner;
  try {
    const viaFetch = async (url) => onRequestGet({ request: new Request(String(url)), waitUntil() {} });
    const snap = await scan(["SOFI"], { fetchFn: viaFetch, via: "https://example.workers.dev", log: () => {}, polite: false });
    assert.equal(snap.count, 1);
    assert.ok(snap.stocks.SOFI.calls.length > 5);
  } finally {
    globalThis.fetch = prev;
  }
});
