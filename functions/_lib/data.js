// Fetches and normalizes free market data for one ticker.
// Sources: Cboe delayed quotes (price, option chain with greeks, price history),
// Yahoo Finance quoteSummary (earnings date, fundamentals), Nasdaq (earnings date fallback).

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CBOE = "https://cdn.cboe.com/api/global/delayed_quotes";
const INDEXES = new Set(["SPX", "NDX", "RUT", "VIX", "XSP", "DJX", "OEX", "XEO", "MRUT"]);
const MIN_LEAPS_DAYS = 240; // keep a little below the 270-day floor so near-misses can be shown

export function cleanTicker(raw) {
  const t = String(raw || "").trim().toUpperCase().replace(/^\^/, "").replace(/^\$/, "");
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) return null;
  return t;
}

// Cboe prefixes index symbols with an underscore and uses no dots in class shares.
export function cboeSymbol(t) {
  if (INDEXES.has(t)) return "_" + t;
  return t.replace(/[.\-]/g, "");
}

export function parseOccSymbol(sym) {
  const m = /^(.+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(sym || "").trim());
  if (!m) return null;
  return {
    root: m[1],
    expiry: `20${m[2]}-${m[3]}-${m[4]}`,
    type: m[5],
    strike: parseInt(m[6], 10) / 1000,
  };
}

const num = (x) => {
  const n = typeof x === "string" ? parseFloat(x.replace(/[$,%]/g, "")) : x;
  return typeof n === "number" && isFinite(n) ? n : null;
};

function daysBetween(fromISO, toISO) {
  return Math.round((Date.parse(toISO + "T00:00:00Z") - Date.parse(fromISO + "T00:00:00Z")) / 86400000);
}

async function getJSON(fetchFn, url, init = {}) {
  const res = await fetchFn(url, {
    ...init,
    headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*", ...(init.headers || {}) },
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ---------- Cboe ----------

export function normalizeChain(json, todayISO) {
  const opts = (json && json.data && json.data.options) || [];
  const calls = [];
  for (const o of opts) {
    const p = parseOccSymbol(o.option);
    if (!p || p.type !== "C") continue;
    const dte = daysBetween(todayISO, p.expiry);
    if (dte < MIN_LEAPS_DAYS) continue;
    const bid = num(o.bid) ?? 0;
    const ask = num(o.ask) ?? 0;
    calls.push({
      symbol: o.option,
      expiry: p.expiry,
      dte,
      strike: p.strike,
      bid,
      ask,
      last: num(o.last_trade_price),
      iv: num(o.iv), // decimal, e.g. 0.57
      delta: num(o.delta),
      theta: num(o.theta),
      vega: num(o.vega),
      oi: num(o.open_interest) ?? 0,
      volume: num(o.volume) ?? 0,
    });
  }
  // Some payloads carry the underlying quote next to the chain.
  const d = (json && json.data) || {};
  return {
    calls,
    expiriesAll: [...new Set(opts.map((o) => parseOccSymbol(o.option)?.expiry).filter(Boolean))].sort(),
    underlying: { price: num(d.current_price) ?? num(d.close), iv30: num(d.iv30) },
  };
}

export function normalizeQuote(json) {
  const d = (json && json.data) || {};
  return {
    price: num(d.current_price) ?? num(d.close) ?? num(d.last_trade_price),
    prevClose: num(d.prev_day_close),
    change: num(d.price_change),
    changePct: num(d.price_change_percent),
    iv30: num(d.iv30), // percent, e.g. 57.26
    lastTradeTime: d.last_trade_time || null,
  };
}

export function normalizeHistory(json) {
  const rows = Array.isArray(json && json.data) ? json.data : [];
  return rows
    .map((r) => ({ d: r.date, c: num(r.close) }))
    .filter((r) => r.d && r.c && r.c > 0)
    .sort((a, b) => (a.d < b.d ? -1 : 1))
    .slice(-420);
}

// ---------- Yahoo ----------

async function yahooSession(fetchFn) {
  const r = await fetchFn("https://fc.yahoo.com/", { headers: { "User-Agent": UA }, redirect: "manual" });
  let cookies = [];
  if (typeof r.headers.getSetCookie === "function") cookies = r.headers.getSetCookie();
  else if (r.headers.get("set-cookie")) cookies = [r.headers.get("set-cookie")];
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  const cr = await fetchFn("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Cookie: cookie },
  });
  const crumb = (await cr.text()).trim();
  if (!cr.ok || !crumb || crumb.length > 40 || /[<{\s]/.test(crumb)) throw new Error("Yahoo crumb unavailable");
  return { cookie, crumb };
}

const raw = (x) => (x && typeof x === "object" ? num(x.raw) : num(x));

export function normalizeYahoo(json, todayISO) {
  const r = json && json.quoteSummary && json.quoteSummary.result && json.quoteSummary.result[0];
  if (!r) return null;
  const fd = r.financialData || {};
  const ks = r.defaultKeyStatistics || {};
  const sd = r.summaryDetail || {};
  const pr = r.price || {};
  const ap = r.assetProfile || {};
  const ce = (r.calendarEvents && r.calendarEvents.earnings) || {};
  const dates = (ce.earningsDate || [])
    .map((d) => raw(d))
    .filter(Boolean)
    .map((s) => new Date(s * 1000).toISOString().slice(0, 10))
    .filter((d) => d >= todayISO)
    .sort();
  return {
    name: pr.longName || pr.shortName || null,
    quoteType: pr.quoteType || null,
    sector: ap.sector || null,
    industry: ap.industry || null,
    marketCap: raw(sd.marketCap) ?? raw(pr.marketCap),
    trailingPE: raw(sd.trailingPE),
    forwardPE: raw(ks.forwardPE) ?? raw(sd.forwardPE),
    revenueGrowth: raw(fd.revenueGrowth),
    earningsGrowth: raw(fd.earningsGrowth),
    profitMargin: raw(fd.profitMargins),
    operatingMargin: raw(fd.operatingMargins),
    freeCashflow: raw(fd.freeCashflow),
    debtToEquity: raw(fd.debtToEquity),
    returnOnEquity: raw(fd.returnOnEquity),
    recommendationKey: fd.recommendationKey || null,
    recommendationMean: raw(fd.recommendationMean),
    analystCount: raw(fd.numberOfAnalystOpinions),
    targetMean: raw(fd.targetMeanPrice),
    beta: raw(sd.beta) ?? raw(ks.beta),
    dividendYield: raw(sd.dividendYield),
    earningsDate: dates[0] || null,
  };
}

async function fetchYahoo(fetchFn, ticker, todayISO) {
  const { cookie, crumb } = await yahooSession(fetchFn);
  const modules = "price,summaryDetail,financialData,defaultKeyStatistics,calendarEvents,assetProfile";
  const ysym = ticker.replace(/\./g, "-");
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ysym)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}`;
  const json = await getJSON(fetchFn, url, { headers: { Cookie: cookie } });
  return normalizeYahoo(json, todayISO);
}

// ---------- Nasdaq (earnings date fallback) ----------

export function parseNasdaqEarnings(json, todayISO) {
  const d = (json && json.data) || {};
  const text = [d.announcement, d.reportText].filter(Boolean).join(" ");
  const m = /([A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+\d{4})/.exec(text);
  if (!m) return null;
  const t = Date.parse(m[1].replace(".", "") + " UTC");
  if (!isFinite(t)) return null;
  const iso = new Date(t).toISOString().slice(0, 10);
  return iso >= todayISO ? iso : null;
}

async function fetchNasdaqEarnings(fetchFn, ticker, todayISO) {
  const json = await getJSON(fetchFn, `https://api.nasdaq.com/api/analyst/${encodeURIComponent(ticker)}/earnings-date`, {
    headers: { Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" },
  });
  return parseNasdaqEarnings(json, todayISO);
}

// ---------- Orchestration ----------

export async function gatherData(ticker, { fetchFn = fetch, now = new Date() } = {}) {
  const todayISO = now.toISOString().slice(0, 10);
  const sym = cboeSymbol(ticker);
  const notes = [];

  const [chainR, quoteR, histR, yahooR] = await Promise.allSettled([
    getJSON(fetchFn, `${CBOE}/options/${sym}.json`),
    getJSON(fetchFn, `${CBOE}/quotes/${sym}.json`),
    getJSON(fetchFn, `${CBOE}/charts/historical/${sym}.json`),
    fetchYahoo(fetchFn, ticker, todayISO),
  ]);

  if (chainR.status === "rejected") {
    const status = chainR.reason && chainR.reason.status;
    return {
      ok: false,
      ticker,
      error:
        status === 403 || status === 404
          ? `No listed options found for ${ticker}. LEAPS need exchange-listed options, so mutual funds and some small stocks can't be checked.`
          : `Couldn't load the option chain for ${ticker} (${chainR.reason && chainR.reason.message}). Try again in a minute.`,
    };
  }

  const chain = normalizeChain(chainR.value, todayISO);
  const quote = quoteR.status === "fulfilled" ? normalizeQuote(quoteR.value) : {};
  if (quoteR.status === "rejected") notes.push("Stock quote endpoint failed; price taken from the option chain.");
  const history = histR.status === "fulfilled" ? normalizeHistory(histR.value) : [];
  if (!history.length) notes.push("Price history unavailable, so trend checks are skipped.");

  let fundamentals = null;
  if (yahooR.status === "fulfilled") fundamentals = yahooR.value;
  else notes.push("Fundamentals source (Yahoo Finance) didn't respond; quality checks use the price trend only.");

  let earningsDate = fundamentals && fundamentals.earningsDate;
  let earningsSource = earningsDate ? "Yahoo Finance" : null;
  if (!earningsDate && !INDEXES.has(ticker)) {
    try {
      earningsDate = await fetchNasdaqEarnings(fetchFn, ticker, todayISO);
      if (earningsDate) earningsSource = "Nasdaq";
    } catch (e) {
      /* fall through */
    }
  }

  const price = quote.price ?? chain.underlying.price ?? (history.length ? history[history.length - 1].c : null);
  if (!price) return { ok: false, ticker, error: `Couldn't get a current price for ${ticker}.` };

  // Only in- or near-the-money calls can reach the 0.65+ delta range; drop the rest to keep the payload small.
  const calls = chain.calls.filter((c) => c.strike <= price * 1.1);

  return {
    ok: true,
    ticker,
    isIndex: INDEXES.has(ticker),
    asOf: (chainR.value && chainR.value.timestamp) || now.toISOString(),
    today: todayISO,
    price,
    prevClose: quote.prevClose ?? null,
    changePct: quote.changePct ?? null,
    iv30: quote.iv30 ?? chain.underlying.iv30 ?? null,
    lastExpiry: chain.expiriesAll[chain.expiriesAll.length - 1] || null,
    calls,
    history,
    fundamentals,
    earnings: { date: earningsDate || null, source: earningsSource },
    notes,
  };
}
