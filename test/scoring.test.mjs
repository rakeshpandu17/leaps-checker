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
