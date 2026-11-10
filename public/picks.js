// "Today's top LEAPS picks": ranks every stock and ETF in the latest scan for the LEAPS strategy, whatever the
// portfolio size. A pick needs a contract that passes the checks (not No-go, tight market). The score
// (0 to 100) weighs the trend, strength against the S&P 500, how cheap the options are, analyst upside,
// business quality, the contract's cost of time, and recent news and earnings timing. It is a screen, not advice.
import { analyze, ivRank, sma, daysBetween, IV_RANK_MIN_DAYS } from "./scoring.js";
import { fromSnapshot } from "./snapshot.js";

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const lin = (x, x0, x1, y0, y1) => y0 + (clamp(x, Math.min(x0, x1), Math.max(x0, x1)) - x0) / (x1 - x0) * (y1 - y0);
const ret = (closes, n) => (closes.length > n ? (closes[closes.length - 1] / closes[closes.length - 1 - n] - 1) * 100 : null);

const INDEXES = [["SPY", "S&P 500"], ["QQQ", "Nasdaq 100"], ["IWM", "Small caps"]];
const SECTORS = {
  XLK: "Tech", XLF: "Financials", XLE: "Energy", XLV: "Health care", XLI: "Industrials", XLY: "Consumer discretionary",
  XLP: "Consumer staples", XLU: "Utilities", XLB: "Materials", XLRE: "Real estate", XLC: "Communications", SMH: "Semiconductors",
};

function trendOf(closes, price) {
  const last = price ?? closes[closes.length - 1];
  const s50 = sma(closes, 50), s200 = sma(closes, 200);
  const state = s200 == null || s50 == null ? "mixed"
    : last > s200 && s50 > s200 ? "up"
    : last < s200 && s50 < s200 ? "down" : "mixed";
  return { state, s50, s200, ret1m: ret(closes, 21), ret3m: ret(closes, 63), ret6m: ret(closes, 126) };
}

// The market backdrop: the big index ETFs against their 50- and 200-day averages, and the sectors leading
// and lagging over three months.
export function marketMood(snap) {
  const st = snap.stocks || {};
  const indexes = INDEXES.filter(([t]) => st[t]?.closes?.length >= 60).map(([t, name]) => {
    const s = st[t];
    return { t, name, price: s.price, changePct: s.changePct, ...trendOf(s.closes, s.price) };
  });
  const ups = indexes.filter((x) => x.state === "up").length, downs = indexes.filter((x) => x.state === "down").length;
  const state = !indexes.length ? "unknown" : ups >= 2 && !downs ? "up" : downs >= 2 && !ups ? "down" : "mixed";
  const sectors = Object.entries(SECTORS).filter(([t]) => st[t]?.closes?.length >= 64)
    .map(([t, name]) => ({ t, name, ret3m: ret(st[t].closes, 63) }))
    .sort((a, b) => b.ret3m - a.ret3m);
  const spy = indexes.find((x) => x.t === "SPY");
  return { state, indexes, leaders: sectors.slice(0, 3), laggards: sectors.slice(-2).reverse(), spy3m: spy ? spy.ret3m : null };
}

// Scores one analyzed ticker. Returns the total, the parts, and short plain-language reasons.
export function scorePick(d, a, mood) {
  const closes = d.history.map((h) => h.c);
  const tr = trendOf(closes, d.price);
  const f = d.fundamentals || {};
  const isFund = f.quoteType === "ETF" || d.isIndex;
  const b = a.best;
  const why = [];

  // Trend, 30 points.
  let trend = 0;
  if (tr.s200 != null && d.price > tr.s200) trend += 10;
  if (tr.s50 != null && tr.s200 != null && tr.s50 > tr.s200) trend += 8;
  if (a.trend?.sma50Rising) trend += 4;
  if (tr.ret6m != null) trend += lin(tr.ret6m, -15, 35, 0, 8);
  if (tr.state === "up") why.push(["Uptrend", "pass"]);
  else if (tr.state === "down") why.push(["Downtrend", "fail"]);

  // Strength against the S&P 500 over three months, 10 points.
  let rel = 5;
  if (tr.ret3m != null && mood.spy3m != null) {
    const gap = tr.ret3m - mood.spy3m;
    rel = lin(gap, -15, 15, 0, 10);
    if (gap >= 5) why.push([`Beats S&P by ${Math.round(gap)}% (3 mo)`, "pass"]);
  }

  // Cheap options, 15 points: the real IV rank once there's enough history, else IV against realized volatility.
  let iv = 7;
  const r = d.ivHist ? ivRank(d.iv30, d.ivHist) : null;
  if (r && r.days >= IV_RANK_MIN_DAYS && r.rank != null) {
    iv = lin(r.rank, 80, 10, 0, 15);
    if (r.rank <= 30) why.push([`IV rank ${Math.round(r.rank)} (cheap)`, "pass"]);
    else if (r.rank >= 70) why.push([`IV rank ${Math.round(r.rank)} (pricey)`, "warn"]);
  } else if (a.ivc?.ratio != null) {
    iv = lin(a.ivc.ratio, 1.5, 0.9, 0, 15);
    if (a.ivc.ratio <= 0.95) why.push(["Options cheap", "pass"]);
    else if (a.ivc.ratio >= 1.3) why.push(["Options pricey", "warn"]);
  }

  // Analyst upside, 15 points (funds have no target: neutral).
  let upside = 6, upPct = null;
  if (f.targetMean > 0) {
    upPct = (f.targetMean / d.price - 1) * 100;
    upside = lin(upPct, 0, 35, 0, 12) + (f.recommendationMean > 0 ? (f.recommendationMean <= 2 ? 3 : f.recommendationMean <= 2.5 ? 1.5 : 0) : 0);
    if (upPct >= 10) why.push([`+${Math.round(upPct)}% to target`, "pass"]);
  }

  // Business quality, 10 points (funds: neutral).
  let quality = 7;
  if (!isFund) {
    quality = 0;
    if (f.revenueGrowth != null) quality += f.revenueGrowth > 0.05 ? 4 : f.revenueGrowth > 0 ? 2 : 0;
    if (f.profitMargin != null) quality += f.profitMargin > 0.1 ? 4 : f.profitMargin > 0 ? 2 : 0;
    if (f.freeCashflow > 0) quality += 2;
  }

  // The contract, 10 points: less time value and a tighter market are better.
  let contract = 0;
  if (b) {
    if (b.extrinsicPctOfPremium != null) contract += lin(b.extrinsicPctOfPremium, 40, 8, 0, 7);
    if (b.spreadPct != null) contract += lin(b.spreadPct, 5, 1, 0, 3);
  }

  // News and earnings timing, 10 points.
  let news = 7;
  const recent = (d.news || []).filter((n) => daysBetween(n.time.slice(0, 10), d.today) <= 7);
  const tags = new Set(recent.flatMap((n) => n.tags || []));
  if (tags.has("positive")) { news += 3; why.push(["Good news", "pass"]); }
  if (tags.has("risk")) { news -= 5; why.push(["Risk in news", "fail"]); }
  const ed = d.earnings?.date;
  const toEarn = ed ? daysBetween(d.today, ed) : null;
  if (toEarn != null && toEarn >= 0 && toEarn <= 14) { news -= 4; why.push([`Earnings in ${toEarn} day${toEarn === 1 ? "" : "s"}`, "warn"]); }
  news = clamp(news, 0, 10);

  const parts = { trend, rel, iv, upside, quality, contract, news };
  const score = Math.round(Object.values(parts).reduce((s, x) => s + x, 0));
  return { score, parts, why: why.slice(0, 4), trend: tr, upPct, toEarn };
}

// An eligible pick has a contract that passes the checks and has a tight market (like the portfolio ideas).
export function eligible(a) {
  return !!(a.best && a.verdict.level !== "nogo" && a.checks.find((c) => c.id === 5)?.state === "pass");
}

export function topPicks(snap, ivh, todayISO, limit = 12) {
  const mood = marketMood(snap);
  const out = [];
  for (const [t, s] of Object.entries(snap.stocks || {})) {
    const d = fromSnapshot(t, s, todayISO);
    d.ivHist = (ivh && ivh.iv && ivh.iv[t]) || null;
    const a = analyze(d, { contracts: 1 });
    if (!eligible(a)) continue;
    out.push({ t, d, a, ...scorePick(d, a, mood) });
  }
  out.sort((x, y) => y.score - x.score);
  return { mood, picks: out.slice(0, limit), eligible: out.length, scanned: Object.keys(snap.stocks || {}).length };
}
