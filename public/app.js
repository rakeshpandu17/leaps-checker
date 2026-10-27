import { analyze, daysBetween } from "./scoring.js";
import { UNIVERSE, NAMES } from "./universe.js";
import { fromSnapshot, SNAPSHOT_MAX_AGE_DAYS } from "./snapshot.js";

const $ = (id) => document.getElementById(id);
const PREFS = "leaps-go-prefs-v1";
const IDEA_BUDGET = 0.03; // one contract may cost at most 3% of the portfolio
const IDEA_LIMIT = 20;
const ROLL_TIP = "Sell means closing the trade: you sell the call back and keep whatever it is worth. " +
  "Roll means selling this call and buying a new one with a later expiry, often at a higher strike, so you keep your position in the stock. " +
  "Doing either about 9 months before expiry avoids the fast time decay in an option's last months.";
const LABEL = { pass: "Pass", warn: "Caution", fail: "Fail", info: "Info" };
const BADGE = { go: "Go", wait: "Wait", nogo: "No-go" };

let data = null;
// What the ideas list showed for each ticker, so the full check can explain a different live verdict.
const ideaInfo = new Map();
let ideaRef = null;

const fmt$ = (x) => (x == null ? "n/a" : "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const fmt0 = (x) => "$" + Math.round(x).toLocaleString("en-US");
const fmtPct = (x, d = 1) => (x == null ? "n/a" : (x >= 0 ? "+" : "") + x.toFixed(d) + "%");
const fmtDate = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtBig = (x) => {
  if (x == null) return "n/a";
  const a = Math.abs(x);
  return a >= 1e12 ? "$" + (x / 1e12).toFixed(2) + "T" : a >= 1e9 ? "$" + (x / 1e9).toFixed(1) + "B" : a >= 1e6 ? "$" + (x / 1e6).toFixed(0) + "M" : fmt$(x);
};

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) || "{}");
    if (p.portfolio) $("portfolio").value = p.portfolio;
    if (p.contracts) $("contracts").value = p.contracts;
    return p;
  } catch (e) {
    return {};
  }
}
function savePrefs(extra = {}) {
  try {
    const old = JSON.parse(localStorage.getItem(PREFS) || "{}");
    const p = { ...old, portfolio: $("portfolio").value, contracts: $("contracts").value, ...extra };
    localStorage.setItem(PREFS, JSON.stringify(p));
  } catch (e) {}
}

function settings() {
  const pv = parseFloat(String($("portfolio").value).replace(/[$,\s]/g, ""));
  const n = parseInt($("contracts").value, 10);
  return {
    portfolio: isFinite(pv) && pv > 0 ? pv : null,
    contracts: isFinite(n) && n > 0 ? n : 1,
    earningsOverride: $("earn").value || null,
  };
}

function setStatus(msg, isError = false) {
  const s = $("status");
  s.textContent = msg || "";
  s.className = "status" + (isError ? " error" : "");
}

const cache = new Map(); // ticker -> { at, promise }
const CACHE_MS = 5 * 60 * 1000;

function fetchAnalysis(ticker) {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}`)
    .then((res) => res.json().catch(() => ({ ok: false, error: `Server error (${res.status}).` })))
    .catch((e) => ({ ok: false, error: `Couldn't reach the data service: ${e.message}` }));
  cache.set(ticker, { at: Date.now(), promise });
  promise.then((b) => { if (!b.ok) cache.delete(ticker); });
  return promise;
}

async function run(ticker, fromIdeas = false) {
  ticker = String(ticker || "").trim().toUpperCase();
  if (!ticker) return;
  ideaRef = fromIdeas ? ideaInfo.get(ticker) || null : null;
  $("ticker").value = ticker;
  $("go").disabled = true;
  $("earn").value = "";
  setStatus(`Loading ${ticker}: price, LEAPS chain, earnings date and company data…`);
  try {
    const body = await fetchAnalysis(ticker);
    if (!body.ok) {
      data = null;
      $("result").hidden = true;
      setStatus(body.error || "Something went wrong.", true);
      return;
    }
    data = body;
    setStatus("");
    const url = new URL(location.href);
    url.searchParams.set("t", ticker);
    history.replaceState(null, "", url);
    savePrefs({ last: ticker });
    render();
    if (fromIdeas) $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    setStatus(`Couldn't reach the data service: ${e.message}`, true);
  } finally {
    $("go").disabled = false;
  }
}

const NEWS_TAGS = { results: ["Results", "info"], risk: ["Watch out", "fail"], positive: ["Positive", "pass"] };

function ago(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(iso.slice(0, 10));
}

function renderNews(news) {
  const ul = $("newsList");
  ul.replaceChildren();
  if (!news) return ul.append(el("li", { class: "empty" }, "Headlines didn't load this time. Try again in a minute."));
  if (!news.length) return ul.append(el("li", { class: "empty" }, "No headlines in the last two weeks."));
  for (const n of news.slice(0, 6)) {
    ul.append(el("li", {},
      el("a", { href: n.link, target: "_blank", rel: "noopener noreferrer" }, n.title),
      el("span", { class: "meta" },
        [n.publisher, ago(n.time)].filter(Boolean).join(" · "),
        ...n.tags.map((t) => el("span", { class: "pill " + NEWS_TAGS[t][1] }, NEWS_TAGS[t][0])))));
  }
}

function render() {
  if (!data) return;
  const st = settings();
  const budget = st.portfolio ? st.portfolio * IDEA_BUDGET : 0;
  let a = analyze(data, { ...st, maxCost: budget });
  let budgetNote = budget && a.best ? `Contract chosen to cost no more than ${fmt$(budget)} (3% of your portfolio).` : "";
  if (a.overBudget || (budget && !a.best)) {
    a = analyze(data, st);
    if (a.best) budgetNote = `No qualifying contract costs under ${fmt$(budget)} (3% of your portfolio), so the best overall contract is shown.`;
  }
  const v = a.verdict;

  const box = $("verdict");
  box.className = "verdict " + v.level;
  $("vBadge").textContent = BADGE[v.level];
  $("vHead").textContent = v.headline;
  $("vSub").textContent =
    `${data.ticker} ${fmt$(data.price)}` +
    (data.changePct != null ? ` (${fmtPct(data.changePct, 2)} today)` : "") +
    ` · data as of ${data.asOf} ET, delayed`;
  const ul = $("vReasons");
  ul.replaceChildren();
  const reasons = v.reasons.length ? v.reasons : ["All core checks pass. Keep it small and follow the exit plan."];
  for (const r of reasons) ul.append(el("li", {}, r));
  $("vDiff").replaceChildren();
  $("vDiff").hidden = true;
  const nb = a.best, same = !!nb && nb.symbol === ideaRef?.symbol;
  if (ideaRef && ideaRef.t === data.ticker && (ideaRef.level !== v.level || !same)) {
    const changed = ideaRef.level !== v.level ? ` The verdict is now ${BADGE[v.level]}.` : "";
    $("vDiff").append(
      el("strong", {}, "Why this differs from the ideas list: "),
      `the list used prices from ${ideaRef.when}, when the ${ideaRef.contract} call was ${BADGE[ideaRef.level]} at bid ${fmt$(ideaRef.bid)} / ask ${fmt$(ideaRef.ask)} ` +
      `(spread ${ideaRef.spread.toFixed(1)}%, open interest ${ideaRef.oi.toLocaleString("en-US")}). ` +
      (same
        ? `Its latest quote is bid ${fmt$(nb.bid)} / ask ${fmt$(nb.ask)} (spread ${nb.spreadPct.toFixed(1)}%, open interest ${nb.oi.toLocaleString("en-US")}).${changed}`
        : nb ? `With the latest quotes the ${fmtDate(nb.expiry)} $${nb.strike} call fits better.${changed}`
            : `With the latest quotes no contract qualifies.${changed}`) +
      ` This check uses the latest quotes, so go by it rather than the list.`);
    $("vDiff").hidden = false;
  }

  // best contract
  const b = a.best;
  const kv = $("bestKv");
  kv.replaceChildren();
  let tipN = 0;
  const label = (k, tip) => {
    if (!tip) return el("dt", {}, k);
    const id = "tip-" + ++tipN;
    return el("dt", { class: "tip" }, k,
      el("button", { type: "button", class: "tip-btn", "aria-label": `What is ${k}?`, "aria-describedby": id }, "?"),
      el("span", { class: "tip-box", role: "tooltip", id }, tip));
  };
  const row = (k, val, tip, note) =>
    kv.append(label(k, tip), el("dd", {}, el("span", { class: "v" }, val), note ? el("span", { class: "n" }, note) : null));
  if (b) {
    $("bestTitle").textContent = `${data.ticker} ${fmtDate(b.expiry)} $${b.strike} call`;
    row("Mid price", fmt$(b.mid),
      `The fair price, halfway between what buyers are offering (bid, ${fmt$(b.bid)}) and what sellers are asking (ask, ${fmt$(b.ask)}). Place a limit order near ${fmt$(b.mid)} instead of paying the ask.`,
      `${fmt$(b.bid)} – ${fmt$(b.ask)}`);
    row("Cost per contract", fmt$(b.mid * 100),
      `One contract covers 100 shares, so you pay the price × 100 = ${fmt$(b.mid * 100)}. This is the most you can lose on one contract.`);
    row("Delta", b.delta.toFixed(2),
      `How much the option moves when the stock moves $1. At ${b.delta.toFixed(2)}, a $1 rise in ${data.ticker} adds about ${fmt$(b.delta)} per share to the option. Closer to 1 means it acts more like owning the stock.` + (b.computedGreeks ? " This one is computed from the option price, because the quote had no Greeks." : ""),
      b.computedGreeks ? "computed" : null);
    row("Break-even", fmt$(b.breakeven),
      `The stock price you need at expiry just to get your money back: strike $${b.strike} + price ${fmt$(b.mid)} = ${fmt$(b.breakeven)}. That is ${fmtPct(b.breakevenPct)} from today. Above it you profit.`,
      `${fmtPct(b.breakevenPct)} away`);
    row("Extrinsic", fmt$(b.extrinsic),
      `The part of the price you pay for time, on top of the option's built-in value (stock − strike). It shrinks to zero by expiry, so it's what you lose if the stock goes nowhere. Lower is better.`,
      `${b.extrinsicPctOfPremium.toFixed(0)}% of premium`);
    row("Days to expiry", String(b.dte),
      `Days until the option expires on ${fmtDate(b.expiry)}. More time gives the stock room to rise. Plan to sell or roll it about 9 months before expiry, when time decay speeds up.`,
      `${(b.dte / 30.44).toFixed(1)} months`);
    row("Implied vol", b.iv ? (b.iv * 100).toFixed(1) + "%" : "n/a",
      "How big a yearly price swing the market is pricing in. Higher implied volatility makes options more expensive, and it often drops after earnings.");
    row("Open interest", b.oi.toLocaleString("en-US"),
      "How many of these exact contracts are open right now. More open interest usually means more buyers and sellers, so it's easier to get in and out at a fair price. Hundreds or more is good.");
    row("Contract", b.symbol,
      `The option's official code: ticker, expiry date (YYMMDD), C for call, and the strike × 1000. Search it at your broker to find this exact contract.`);
  } else {
    $("bestTitle").textContent = "No contract fits";
    row("Longest expiry", data.lastExpiry ? fmtDate(data.lastExpiry) : "n/a",
      "The furthest-out expiry date listed for this ticker. LEAPS need one at least 9 to 12 months away.");
    row("LEAPS calls found", String(data.calls.length),
      "How many long-dated call options are listed near today's price. None of them passed the delta, time and liquidity rules.");
  }

  // stock card
  const f = data.fundamentals || {};
  $("stockTitle").textContent = f.name ? `${f.name} (${data.ticker})` : data.ticker;
  const sk = $("stockKv");
  sk.replaceChildren();
  const srow = (k, val, tip, note) =>
    val != null && sk.append(label(k, tip), el("dd", {}, el("span", { class: "v" }, val), note ? el("span", { class: "n" }, note) : null));
  const S = data.price;
  const vs = (x) => (x ? `${fmtPct((S / x - 1) * 100)} ${S >= x ? "above" : "below"}`.replace(/^\+|^-/, "") : null);
  srow("Price", fmt$(S),
    `The latest ${data.ticker} share price, about 15 minutes delayed.` + (data.changePct != null ? ` It is ${fmtPct(data.changePct, 2)} today.` : ""),
    data.changePct != null ? `${fmtPct(data.changePct, 2)} today` : null);
  const t = a.trend;
  if (t) {
    if (t.sma50 != null) srow("50-day avg", fmt$(t.sma50),
      `The average closing price over the last 50 trading days (about 2.5 months). A price above it suggests a short-term uptrend; below it, a short-term downtrend.`,
      vs(t.sma50));
    if (t.sma200 != null) srow("200-day avg", fmt$(t.sma200),
      `The average closing price over the last 200 trading days (about 10 months). It shows the long-term trend. For a LEAPS call you ideally want the price above it, and the 50-day above the 200-day.`,
      vs(t.sma200));
    srow("52-week range", `${fmt$(t.low52)} – ${fmt$(t.high52)}`,
      `The lowest and highest closing prices over the past year. Today's price is ${fmtPct(t.fromHighPct)} from the high and ${fmtPct(t.fromLowPct)} from the low.`,
      `${fmtPct(t.fromHighPct)} from high`);
    if (t.ret1y != null) srow("1-year return", fmtPct(t.ret1y),
      `How much the share price has changed over the past year, not counting dividends.`);
  }
  if (data.iv30 != null) srow("30-day IV", data.iv30.toFixed(1) + "%",
    `Implied volatility: how big a yearly price swing the options market expects over the next 30 days. Higher IV makes options more expensive.`,
    a.ivc.ratio != null ? `${a.ivc.ratio.toFixed(2)}× normal` : null);
  if (a.ivc.hv1y != null) srow("1-yr realized vol", a.ivc.hv1y.toFixed(1) + "%",
    `How much the stock actually swung over the past year, as a yearly figure. If 30-day IV is well above this, options are pricier than usual.`);
  const ed = settings().earningsOverride || data.earnings.date;
  const edDays = ed ? daysBetween(data.today, ed) : null;
  srow("Next earnings", ed ? fmtDate(ed) : data.isIndex ? "n/a" : "not found",
    data.isIndex ? "Indexes don't report earnings."
      : ed ? `The next scheduled earnings report${settings().earningsOverride ? " (the date you entered)" : data.earnings.source ? `, from ${data.earnings.source}` : ""}. Options are usually expensive just before earnings and get cheaper right after, so it's often better to buy after the report.`
      : "We couldn't find the next earnings date. Look it up and enter it in the box below, so the IV check can use it.",
    edDays === 0 ? (ed === data.earnings.date && data.earnings.timing === "before-open" ? "today, before the open"
      : ed === data.earnings.date && data.earnings.timing === "after-close" ? "today, after the close" : "today")
      : edDays != null && edDays > 0 ? `in ${edDays} day${edDays === 1 ? "" : "s"}` : null);
  if (f.exDividendDate && daysBetween(data.today, f.exDividendDate) >= 0) srow("Ex-dividend", fmtDate(f.exDividendDate),
    "The first day the stock trades without its next dividend. The price usually drops by about the dividend that day. Call holders don't receive dividends.",
    `in ${daysBetween(data.today, f.exDividendDate)} days`);
  renderNews(data.news);
  if (f.sector) srow("Sector", f.sector,
    `The part of the economy the company belongs to${f.industry ? `. Its industry is ${f.industry}` : ""}.`);
  if (f.marketCap != null) srow("Market cap", fmtBig(f.marketCap),
    "The total value of all the company's shares (share price × shares outstanding). Bigger companies are usually more stable.");
  if (f.revenueGrowth != null) srow("Revenue growth", fmtPct(f.revenueGrowth * 100),
    "How much the company's sales grew compared with the same quarter a year ago. Steady growth supports a long-term bullish bet.",
    "year over year");
  if (f.profitMargin != null) srow("Profit margin", fmtPct(f.profitMargin * 100),
    "The share of revenue left as profit after all costs. Positive and rising is a good sign.");
  if (f.forwardPE != null) srow("Forward P/E", f.forwardPE.toFixed(1),
    "Share price divided by next year's expected earnings per share. It shows how much investors pay for each $1 of future profit. Lower can mean cheaper, but compare it with similar companies.");

  // checks
  const detail = (d) => {
    if (!d.startsWith("Sell or roll")) return el("li", {}, d);
    const id = "tip-" + ++tipN;
    return el("li", {},
      el("span", { class: "tip inline" }, "Sell or roll",
        el("button", { type: "button", class: "tip-btn", "aria-label": "What does sell or roll mean?", "aria-describedby": id }, "?"),
        el("span", { class: "tip-box", role: "tooltip", id }, ROLL_TIP)),
      d.slice("Sell or roll".length));
  };
  const cbox = $("checks");
  cbox.replaceChildren();
  for (const c of a.checks) {
    const details = c.details.length ? el("ul", { class: "details" }, ...c.details.map(detail)) : null;
    cbox.append(
      el("article", { class: "check" },
        el("span", { class: "num" }, String(c.id).padStart(2, "0")),
        el("div", { class: "cbody" },
          el("div", { class: "row1" }, el("h3", {}, c.title), el("span", { class: "pill " + c.state }, LABEL[c.state])),
          el("span", { class: "target" }, "Target: " + c.target),
          el("p", { class: "summary" }, c.summary),
          details)));
  }

  // alternatives
  const tb = $("altBody");
  tb.replaceChildren();
  $("altCard").hidden = !a.alternatives.length;
  for (const c of a.alternatives) {
    tb.append(el("tr", {},
      el("td", {}, fmtDate(c.expiry)),
      el("td", {}, "$" + c.strike),
      el("td", {}, fmt$(c.mid)),
      el("td", {}, c.delta.toFixed(2)),
      el("td", {}, fmtPct(c.breakevenPct)),
      el("td", {}, c.extrinsicPerYearPct.toFixed(1) + "%"),
      el("td", {}, c.spreadPct.toFixed(1) + "%"),
      el("td", {}, c.oi.toLocaleString("en-US"))));
  }

  const p = a.projection;
  if (p) row(p.basis === "analyst target" ? "Return at target" : "Return at +10%/yr", fmtPct(p.optionReturn, 0),
    p.basis === "analyst target"
      ? `What this call would return by expiry if ${data.ticker} reached the analysts' average price target of ${fmt$(p.target)}. A rough guide for comparing ideas, not a forecast.`
      : `What this call would return by expiry if ${data.ticker} grew 10% a year, to about ${fmt$(p.target)}. There is no analyst target, so this is an assumption, not a forecast.`,
    `at ${fmt$(p.target)}`);
  const notes = [budgetNote, data.notes.length ? "Data notes: " + data.notes.join(" ") : ""].filter(Boolean);
  $("notes").textContent = notes.join(" ");
  $("result").hidden = false;
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  savePrefs();
  const typed = $("ticker").value.trim();
  // A highlighted suggestion wins; otherwise an exact ticker match, then the top suggestion that matches the text.
  const pick = combo.current() || combo.resolve(typed);
  combo.close();
  run(pick || toSymbol(typed));
});

// ---------- ticker autocomplete ----------

// Typed text -> ticker: "sofi" -> "SOFI"; a company name that matches one known name exactly -> its ticker.
function toSymbol(text) {
  const t = String(text || "").trim();
  const byName = Object.entries(NAMES).find(([, n]) => n.toLowerCase() === t.toLowerCase());
  return byName ? byName[0] : t.toUpperCase();
}

const combo = (() => {
  const input = $("ticker");
  const list = $("tickerList");
  let items = [];
  let active = -1;
  let timer = null;
  let seq = 0;
  const remote = new Map(); // query -> results

  function localMatches(q) {
    const Q = q.toUpperCase(), lq = q.toLowerCase();
    const scored = [];
    for (const [sym, name] of Object.entries(NAMES)) {
      const n = name.toLowerCase();
      let score = -1;
      if (sym === Q) score = 0;
      else if (sym.startsWith(Q)) score = 1;
      else if (n.startsWith(lq)) score = 2;
      else if (n.split(/[\s(&-]+/).some((w) => w.startsWith(lq))) score = 3;
      if (score >= 0) scored.push({ score, symbol: sym, name, type: /ETF|SPDR|iShares|Invesco/.test(name) ? "ETF" : /Index$/.test(name) ? "Index" : "Stock" });
    }
    return scored.sort((a, b) => a.score - b.score || a.symbol.length - b.symbol.length).slice(0, 8);
  }

  function merge(a, b) {
    const seen = new Set();
    return [...a, ...b].filter((x) => !seen.has(x.symbol) && seen.add(x.symbol)).slice(0, 8);
  }

  function highlight(text, q) {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (!q || i < 0) return [text];
    return [text.slice(0, i), el("mark", {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
  }

  function render(q) {
    list.replaceChildren();
    if (!items.length) {
      if (q.length >= 2) list.append(el("li", { class: "empty", role: "option", "aria-disabled": "true" }, `No match for "${q}". Press Enter to try it as a ticker.`));
      else return close();
    }
    items.forEach((it, i) => {
      list.append(el("li", { id: "opt-" + i, role: "option", "aria-selected": String(i === active), "data-i": String(i) },
        el("span", { class: "sym" }, ...highlight(it.symbol, q)),
        el("span", { class: "nm" }, ...highlight(it.name, q)),
        el("span", { class: "ty" }, it.type)));
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", "opt-" + active);
    else input.removeAttribute("aria-activedescendant");
  }

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function update() {
    const q = input.value.trim();
    if (!q) { items = []; return close(); }
    const local = localMatches(q);
    items = merge(local, remote.get(q.toLowerCase()) || []);
    active = -1;
    render(q);
    clearTimeout(timer);
    if (remote.has(q.toLowerCase())) return;
    const my = ++seq;
    timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((x) => x.json());
        const res = (r && r.results) || [];
        remote.set(q.toLowerCase(), res);
        if (my !== seq || input.value.trim() !== q) return;
        items = merge(local, res);
        render(q);
      } catch (e) {}
    }, 200);
  }

  function choose(i) {
    const it = items[i];
    if (!it) return;
    input.value = it.symbol;
    close();
    savePrefs();
    run(it.symbol);
  }

  input.addEventListener("input", update);
  input.addEventListener("focus", () => { if (input.value.trim() && document.activeElement === input && items.length) render(input.value.trim()); });
  input.addEventListener("blur", () => setTimeout(close, 120));
  input.addEventListener("keydown", (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = e.key === "ArrowDown" ? (active + 1) % items.length : (active <= 0 ? items.length - 1 : active - 1);
      render(input.value.trim());
      list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Escape") {
      close();
    } else if (e.key === "Tab" && active >= 0) {
      input.value = items[active].symbol;
      close();
    }
  });
  list.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus so the click lands
  list.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) choose(+li.dataset.i);
  });

  return {
    // The highlighted suggestion, if the user arrowed to one before pressing Enter.
    current: () => (!list.hidden && active >= 0 && items[active] ? items[active].symbol : null),
    resolve: (text) => {
      const T = text.toUpperCase(), lt = text.toLowerCase();
      const exact = items.find((x) => x.symbol === T);
      if (exact) return exact.symbol;
      const hit = items.find((x) => x.symbol.startsWith(T) || x.name.toLowerCase().includes(lt));
      return hit ? hit.symbol : null;
    },
    close,
  };
})();
$("quick").addEventListener("click", (e) => {
  const t = e.target.closest("button[data-t]");
  if (t) run(t.dataset.t);
});
for (const id of ["portfolio", "contracts"]) $(id).addEventListener("input", () => { savePrefs(); render(); });
let ideasTimer = null;
$("portfolio").addEventListener("input", () => {
  clearTimeout(ideasTimer);
  ideasTimer = setTimeout(() => { setIdeasOpen(true); screen(); }, 900);
});
$("ideasRefresh").addEventListener("click", () => { setIdeasOpen(true); screen(true); });
$("ideasToggle").addEventListener("click", () => setIdeasOpen($("ideasPanel").hidden));
// Opening a ticker from the list folds the list away, so the page focuses on that ticker.
const openIdea = (t) => { setIdeasOpen(false); run(t, true); };
$("ideasBody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-t]");
  if (tr) openIdea(tr.dataset.t);
});
$("ideasBody").addEventListener("keydown", (e) => {
  const tr = e.target.closest("tr[data-t]");
  if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openIdea(tr.dataset.t); }
});

function setIdeasOpen(open) {
  $("ideasPanel").hidden = !open;
  $("ideas").classList.toggle("collapsed", !open);
  $("ideasToggle").setAttribute("aria-expanded", String(open));
  $("ideasToggle").textContent = open ? "Hide list" : "Show list";
}
$("earn").addEventListener("change", render);

// ---------- idea screener ----------

let screenRun = 0;

// An idea needs a priced, non-No-go contract with fully passing liquidity (spread 5% or less, open interest 100+),
// because a thin contract's quote can swing enough by the time someone opens it to flip the verdict.
function fitsIdeas(a) {
  return !!(a.best && a.projection && a.verdict.level !== "nogo" && a.checks.find((c) => c.id === 5)?.state === "pass");
}

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

async function screen(force = false) {
  const pv = settings().portfolio;
  const box = $("ideas");
  const id = ++screenRun;
  if (!pv) { box.hidden = true; $("quick").hidden = false; return; }
  if (force) cache.clear();
  const budget = pv * IDEA_BUDGET;
  box.hidden = false;
  $("quick").hidden = true;
  $("ideasTitle").textContent = `Up to ${IDEA_LIMIT} LEAPS ideas for a ${fmt0(pv)} portfolio`;
  $("ideasSub").textContent = `One contract must cost ${fmt0(budget)} or less (3% of the portfolio).`;
  $("ideasBody").replaceChildren();
  const status = (t) => { if (id === screenRun) $("ideasStatus").textContent = t; };
  const progress = (f) => { if (id === screenRun) { $("ideasProgress").hidden = f >= 1; $("ideasBar").style.width = Math.round(f * 100) + "%"; } };
  progress(0);

  // Preferred: the latest daily scan of ~330 stocks, ranked instantly in the browser.
  status("Loading the latest scan…");
  const snap = await loadSnapshot(force);
  if (id !== screenRun) return;
  if (snap) {
    const today = new Date().toISOString().slice(0, 10);
    const ideas = [];
    for (const [t, s] of Object.entries(snap.stocks)) {
      // A 0.75-delta LEAPS usually costs at least about a quarter of the share price per share.
      if (s.price * 100 * 0.22 > budget) continue;
      const d = fromSnapshot(t, s, today);
      const a = analyze(d, { ...settings(), maxCost: budget, contracts: 1 });
      if (!fitsIdeas(a)) continue;
      ideas.push({ t, d, a });
    }
    const when = new Date(snap.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    renderIdeas(ideas, pv, when);
    progress(1);
    status(ideas.length
      ? `${Math.min(ideas.length, IDEA_LIMIT)} best of ${ideas.length} that fit, from ${snap.count} stocks and ETFs scanned ${when}. Click a row for a live check.`
      : `None of the ${snap.count} stocks scanned ${when} has a LEAPS call that passes the checks and fits ${fmt0(budget)}. Try a larger portfolio value.`);
    return;
  }

  // Fallback: live scan of the shorter built-in list.
  status("Getting prices…");

  // 1. Prices first, to skip stocks whose deep in-the-money calls can't fit the budget.
  const prices = {};
  for (let i = 0; i < UNIVERSE.length; i += 40) {
    try {
      const r = await fetch(`/api/quotes?tickers=${UNIVERSE.slice(i, i + 40).join(",")}`).then((x) => x.json());
      Object.assign(prices, r.quotes || {});
    } catch (e) {}
    if (id !== screenRun) return;
  }
  // A 0.75-delta LEAPS usually costs at least about a quarter of the share price per share.
  const affordable = UNIVERSE.filter((t) => !prices[t] || prices[t].price * 100 * 0.22 <= budget);
  if (!affordable.length) {
    progress(1);
    status(`No stock on the list has LEAPS that fit ${fmt$(budget)}. Try a larger portfolio value.`);
    return;
  }

  // 2. Full check on each affordable ticker.
  const ideas = [];
  let done = 0;
  status(`Checking ${affordable.length} stocks and ETFs that could fit…`);
  await pool(affordable, 4, async (t) => {
    if (id !== screenRun) return;
    const d = await fetchAnalysis(t);
    done++;
    if (id !== screenRun) return;
    progress(done / affordable.length);
    status(`Checked ${done} of ${affordable.length}…`);
    if (!d.ok) return;
    const a = analyze(d, { ...settings(), maxCost: budget, contracts: 1 });
    if (!fitsIdeas(a)) return;
    ideas.push({ t, d, a });
    renderIdeas(ideas, pv, "a few minutes ago");
  });
  if (id !== screenRun) return;
  progress(1);
  status(ideas.length
    ? `${Math.min(ideas.length, IDEA_LIMIT)} idea${ideas.length === 1 ? "" : "s"} from ${affordable.length} checked. Prices are about 15 minutes delayed.`
    : `None of the ${affordable.length} affordable names passed the checks right now. Try a larger portfolio value.`);
}

let snapshotPromise = null;
function loadSnapshot(force) {
  if (force || !snapshotPromise) {
    snapshotPromise = fetch("/data/scan.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j || !j.stocks || !j.generatedAt) return null;
        const ageDays = (Date.now() - Date.parse(j.generatedAt)) / 86400000;
        return ageDays <= SNAPSHOT_MAX_AGE_DAYS ? j : null;
      })
      .catch(() => null);
  }
  return snapshotPromise;
}

function renderIdeas(ideas, pv, when) {
  ideas.sort((x, y) => y.a.projection.annualized - x.a.projection.annualized);
  const tb = $("ideasBody");
  tb.replaceChildren();
  ideaInfo.clear();
  ideas.slice(0, IDEA_LIMIT).forEach(({ t, d, a }, i) => {
    const b = a.best, p = a.projection, cost = b.mid * 100;
    ideaInfo.set(t, { t, when, level: a.verdict.level, symbol: b.symbol, contract: `${fmtDate(b.expiry)} $${b.strike}`,
      bid: b.bid, ask: b.ask, spread: b.spreadPct, oi: b.oi });
    tb.append(el("tr", { "data-t": t, tabindex: "0", title: `Open the full ${t} check` },
      el("td", {}, String(i + 1)),
      el("td", { class: "tk" }, t),
      el("td", {}, el("span", { class: "pill " + (a.verdict.level === "go" ? "pass" : "warn") }, BADGE[a.verdict.level])),
      el("td", {}, `${fmtDate(b.expiry)} $${b.strike}`),
      el("td", {}, fmt$(cost)),
      el("td", {}, (cost / pv * 100).toFixed(1) + "%"),
      el("td", {}, b.delta.toFixed(2)),
      el("td", {}, fmtPct(b.breakevenPct)),
      el("td", { class: p.annualized >= 0 ? "up" : "down" }, fmtPct(p.annualized, 0) + (p.basis === "analyst target" ? "" : " †"))));
  });
}

const prefs = loadPrefs();
const start = new URL(location.href).searchParams.get("t") || prefs.last || "SOFI";
run(start);
screen();

// Column-header tooltips for the alternatives table. The table scrolls sideways, which would clip a
// tooltip inside it, so one shared box sits on the card and is placed under the hovered button.
(() => {
  const card = $("altCard"), box = $("altTip");
  let pinned = null;
  const show = (btn) => {
    box.textContent = btn.dataset.tip;
    box.hidden = false;
    const c = card.getBoundingClientRect(), b = btn.getBoundingClientRect();
    const left = Math.min(Math.max(8, b.left - c.left - 12), c.width - box.offsetWidth - 8);
    box.style.left = left + "px";
    box.style.top = (b.bottom - c.top + 6) + "px";
  };
  const hide = () => { box.hidden = true; pinned = null; };
  card.querySelectorAll("thead .tip-btn").forEach((btn) => {
    btn.setAttribute("aria-describedby", "altTip");
    btn.addEventListener("mouseenter", () => show(btn));
    btn.addEventListener("mouseleave", () => { if (pinned !== btn) hide(); });
    btn.addEventListener("focus", () => show(btn));
    btn.addEventListener("blur", hide);
    btn.addEventListener("click", () => { if (pinned === btn) hide(); else { show(btn); pinned = btn; } });
  });
  card.querySelector(".tbl-wrap").addEventListener("scroll", hide, { passive: true });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
})();
