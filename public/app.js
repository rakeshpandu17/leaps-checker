import { analyze } from "./scoring.js";
import { UNIVERSE } from "./universe.js";

const $ = (id) => document.getElementById(id);
const PREFS = "leaps-go-prefs-v1";
const IDEA_BUDGET = 0.03; // one contract may cost at most 3% of the portfolio
const IDEA_LIMIT = 20;
const LABEL = { pass: "Pass", warn: "Caution", fail: "Fail", info: "Info" };
const BADGE = { go: "Go", wait: "Wait", nogo: "No-go" };

let data = null;

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
  const row = (k, val, tip) => kv.append(label(k, tip), el("dd", {}, val));
  if (b) {
    $("bestTitle").textContent = `${data.ticker} ${fmtDate(b.expiry)} $${b.strike} call`;
    row("Mid price", `${fmt$(b.mid)} (bid ${fmt$(b.bid)} / ask ${fmt$(b.ask)})`,
      `The fair price, halfway between what buyers are offering (bid, ${fmt$(b.bid)}) and what sellers are asking (ask, ${fmt$(b.ask)}). Place a limit order near ${fmt$(b.mid)} instead of paying the ask.`);
    row("Cost per contract", fmt$(b.mid * 100),
      `One contract covers 100 shares, so you pay the price × 100 = ${fmt$(b.mid * 100)}. This is the most you can lose on one contract.`);
    row("Delta", b.delta.toFixed(2) + (b.computedGreeks ? " (computed)" : ""),
      `How much the option moves when the stock moves $1. At ${b.delta.toFixed(2)}, a $1 rise in ${data.ticker} adds about ${fmt$(b.delta)} per share to the option. Closer to 1 means it acts more like owning the stock.`);
    row("Break-even", `${fmt$(b.breakeven)} (${fmtPct(b.breakevenPct)})`,
      `The stock price you need at expiry just to get your money back: strike $${b.strike} + price ${fmt$(b.mid)} = ${fmt$(b.breakeven)}. That is ${fmtPct(b.breakevenPct)} from today. Above it you profit.`);
    row("Extrinsic", `${fmt$(b.extrinsic)} (${b.extrinsicPctOfPremium.toFixed(0)}% of premium)`,
      `The part of the price you pay for time, on top of the option's built-in value (stock − strike). It shrinks to zero by expiry, so it's what you lose if the stock goes nowhere. Lower is better.`);
    row("Days to expiry", String(b.dte),
      `Days until the option expires on ${fmtDate(b.expiry)}. More time gives the stock room to rise. Plan to sell or roll it about 9 months before expiry, when time decay speeds up.`);
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
  const srow = (k, val) => val != null && sk.append(el("dt", {}, k), el("dd", {}, val));
  srow("Price", fmt$(data.price));
  const t = a.trend;
  if (t) {
    srow("50-day avg", t.sma50 != null ? fmt$(t.sma50) : null);
    srow("200-day avg", t.sma200 != null ? fmt$(t.sma200) : null);
    srow("52-week range", `${fmt$(t.low52)} – ${fmt$(t.high52)}`);
    srow("1-year return", t.ret1y != null ? fmtPct(t.ret1y) : null);
  }
  srow("30-day IV", data.iv30 != null ? data.iv30.toFixed(1) + "%" : null);
  srow("1-yr realized vol", a.ivc.hv1y != null ? a.ivc.hv1y.toFixed(1) + "%" : null);
  const ed = settings().earningsOverride || data.earnings.date;
  srow("Next earnings", ed ? fmtDate(ed) + (settings().earningsOverride ? " (yours)" : data.earnings.source ? ` (${data.earnings.source})` : "") : data.isIndex ? "n/a (index)" : "not found");
  srow("Sector", f.sector || null);
  srow("Market cap", f.marketCap != null ? fmtBig(f.marketCap) : null);
  srow("Revenue growth", f.revenueGrowth != null ? fmtPct(f.revenueGrowth * 100) : null);
  srow("Profit margin", f.profitMargin != null ? fmtPct(f.profitMargin * 100) : null);
  srow("Forward P/E", f.forwardPE != null ? f.forwardPE.toFixed(1) : null);

  // checks
  const cbox = $("checks");
  cbox.replaceChildren();
  for (const c of a.checks) {
    const details = c.details.length ? el("ul", { class: "details" }, ...c.details.map((d) => el("li", {}, d))) : null;
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
  if (p) row("If stock hits " + fmt$(p.target), `${fmtPct(p.optionReturn, 0)} by expiry (${p.basis})`,
    p.basis === "analyst target"
      ? `What this call would return by expiry if ${data.ticker} reached the analysts' average price target of ${fmt$(p.target)}. A rough guide for comparing ideas, not a forecast.`
      : `What this call would return by expiry if ${data.ticker} grew 10% a year, to about ${fmt$(p.target)}. There is no analyst target, so this is an assumption, not a forecast.`);
  const notes = [budgetNote, data.notes.length ? "Data notes: " + data.notes.join(" ") : ""].filter(Boolean);
  $("notes").textContent = notes.join(" ");
  $("result").hidden = false;
}

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  savePrefs();
  run($("ticker").value);
});
$("quick").addEventListener("click", (e) => {
  const t = e.target.closest("button[data-t]");
  if (t) run(t.dataset.t);
});
for (const id of ["portfolio", "contracts"]) $(id).addEventListener("input", () => { savePrefs(); render(); });
let ideasTimer = null;
$("portfolio").addEventListener("input", () => {
  clearTimeout(ideasTimer);
  ideasTimer = setTimeout(() => screen(), 900);
});
$("ideasRefresh").addEventListener("click", () => screen(true));
$("ideasBody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-t]");
  if (tr) run(tr.dataset.t, true);
});
$("ideasBody").addEventListener("keydown", (e) => {
  const tr = e.target.closest("tr[data-t]");
  if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); run(tr.dataset.t, true); }
});
$("earn").addEventListener("change", render);

// ---------- idea screener ----------

let screenRun = 0;

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
    if (!a.best || a.verdict.level === "nogo" || !a.projection) return;
    ideas.push({ t, d, a });
    renderIdeas(ideas, pv);
  });
  if (id !== screenRun) return;
  progress(1);
  status(ideas.length
    ? `${Math.min(ideas.length, IDEA_LIMIT)} idea${ideas.length === 1 ? "" : "s"} from ${affordable.length} checked. Prices are about 15 minutes delayed.`
    : `None of the ${affordable.length} affordable names passed the checks right now. Try a larger portfolio value.`);
}

function renderIdeas(ideas, pv) {
  ideas.sort((x, y) => y.a.projection.annualized - x.a.projection.annualized);
  const tb = $("ideasBody");
  tb.replaceChildren();
  ideas.slice(0, IDEA_LIMIT).forEach(({ t, d, a }, i) => {
    const b = a.best, p = a.projection, cost = b.mid * 100;
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
