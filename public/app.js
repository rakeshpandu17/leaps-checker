import { analyze } from "./scoring.js";

const $ = (id) => document.getElementById(id);
const PREFS = "leaps-go-prefs-v1";
const LABEL = { pass: "Pass", warn: "Caution", fail: "Fail", info: "Info" };
const BADGE = { go: "Go", wait: "Wait", nogo: "No-go" };

let data = null;

const fmt$ = (x) => (x == null ? "n/a" : "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
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

async function run(ticker) {
  ticker = String(ticker || "").trim().toUpperCase();
  if (!ticker) return;
  $("ticker").value = ticker;
  $("go").disabled = true;
  $("earn").value = "";
  setStatus(`Loading ${ticker}: price, LEAPS chain, earnings date and company data…`);
  try {
    const res = await fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}`);
    const body = await res.json().catch(() => ({ ok: false, error: `Server error (${res.status}).` }));
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
  } catch (e) {
    setStatus(`Couldn't reach the data service: ${e.message}`, true);
  } finally {
    $("go").disabled = false;
  }
}

function render() {
  if (!data) return;
  const a = analyze(data, settings());
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
  const row = (k, val) => kv.append(el("dt", {}, k), el("dd", {}, val));
  if (b) {
    $("bestTitle").textContent = `${data.ticker} ${fmtDate(b.expiry)} $${b.strike} call`;
    row("Mid price", `${fmt$(b.mid)} (bid ${fmt$(b.bid)} / ask ${fmt$(b.ask)})`);
    row("Cost per contract", fmt$(b.mid * 100));
    row("Delta", b.delta.toFixed(2) + (b.computedGreeks ? " (computed)" : ""));
    row("Break-even", `${fmt$(b.breakeven)} (${fmtPct(b.breakevenPct)})`);
    row("Extrinsic", `${fmt$(b.extrinsic)} (${b.extrinsicPctOfPremium.toFixed(0)}% of premium)`);
    row("Days to expiry", String(b.dte));
    row("Implied vol", b.iv ? (b.iv * 100).toFixed(1) + "%" : "n/a");
    row("Open interest", b.oi.toLocaleString("en-US"));
    row("Contract", b.symbol);
  } else {
    $("bestTitle").textContent = "No contract fits";
    row("Longest expiry", data.lastExpiry ? fmtDate(data.lastExpiry) : "n/a");
    row("LEAPS calls found", String(data.calls.length));
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

  $("notes").textContent = data.notes.length ? "Data notes: " + data.notes.join(" ") : "";
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
$("earn").addEventListener("change", render);

const prefs = loadPrefs();
const start = new URL(location.href).searchParams.get("t") || prefs.last || "SOFI";
run(start);
