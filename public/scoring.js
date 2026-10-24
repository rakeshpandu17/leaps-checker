// LEAPS checklist scoring. Pure functions: data in, checks + verdict out.
// Shared by the browser (app.js) and the Node tests.

export const RISK_FREE = 0.04;
const DAY = 86400000;

// ---------- math helpers ----------

function normCdf(x) {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export function bsCall(S, K, T, sigma, r = RISK_FREE) {
  if (T <= 0 || sigma <= 0) return Math.max(0, S - K);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

export function bsDelta(S, K, T, sigma, r = RISK_FREE) {
  if (T <= 0 || sigma <= 0) return S > K ? 1 : 0;
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  return normCdf(d1);
}

export function impliedVol(price, S, K, T, r = RISK_FREE) {
  if (!(price > 0) || T <= 0) return null;
  if (price <= Math.max(0, S - K * Math.exp(-r * T)) + 1e-6) return null;
  let lo = 0.01, hi = 5;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (bsCall(S, K, T, mid, r) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export function sma(closes, n, endOffset = 0) {
  const end = closes.length - endOffset;
  if (end < n) return null;
  return mean(closes.slice(end - n, end));
}

export function realizedVol(closes) {
  if (closes.length < 3) return null;
  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const m = mean(rets);
  const v = rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * 252);
}

export function addDays(iso, n) {
  return new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY);
}

// ---------- stock context ----------

export function trendInfo(history, price) {
  const closes = history.map((h) => h.c);
  if (closes.length < 60) return null;
  const last = price ?? closes[closes.length - 1];
  const yr = closes.slice(-252);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const sma50Prev = sma(closes, 50, 20);
  const sma200Prev = sma(closes, 200, 20);
  const high52 = Math.max(...yr);
  const low52 = Math.min(...yr);
  return {
    price: last,
    sma50,
    sma200,
    sma50Rising: sma50Prev != null ? sma50 > sma50Prev : null,
    sma200Rising: sma200 != null && sma200Prev != null ? sma200 > sma200Prev : null,
    high52,
    low52,
    fromHighPct: (last / high52 - 1) * 100,
    fromLowPct: (last / low52 - 1) * 100,
    ret1y: yr.length >= 200 ? (last / yr[0] - 1) * 100 : null,
  };
}

// Free sources don't publish IV history, so true IV rank isn't available.
// Proxy: today's 30-day IV against the stock's own realized volatility over the past year.
export function ivContext(iv30Pct, history) {
  const closes = history.map((h) => h.c);
  if (closes.length < 60) return { iv30: iv30Pct, hv1y: null, ratio: null, pctile: null };
  const window = closes.slice(-253);
  const hv1y = realizedVol(window);
  const hvSeries = [];
  for (let end = Math.max(31, closes.length - 252); end <= closes.length; end += 5) {
    hvSeries.push(realizedVol(closes.slice(end - 31, end)));
  }
  const hv30 = realizedVol(closes.slice(-31));
  const iv = iv30Pct != null ? iv30Pct / 100 : null;
  const pctile = iv != null && hvSeries.length ? (hvSeries.filter((h) => h <= iv).length / hvSeries.length) * 100 : null;
  return {
    iv30: iv30Pct,
    hv1y: hv1y * 100,
    hv30: hv30 * 100,
    ratio: iv != null && hv1y > 0 ? iv / hv1y : null,
    pctile,
  };
}

// ---------- contracts ----------

export function enrichCalls(calls, S, todayISO) {
  return calls.map((c) => {
    const mid = c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : c.ask > 0 ? c.ask : c.last || 0;
    const T = Math.max(1, daysBetween(todayISO, c.expiry)) / 365;
    let iv = c.iv && c.iv > 0.01 ? c.iv : null;
    let delta = c.delta && c.delta > 0 && c.delta <= 1 ? c.delta : null;
    let computed = false;
    if (!iv && mid > 0) {
      iv = impliedVol(mid, S, c.strike, T);
      computed = !!iv;
    }
    if (delta == null && iv) {
      delta = bsDelta(S, c.strike, T, iv);
      computed = true;
    }
    const intrinsic = Math.max(0, S - c.strike);
    const extrinsic = Math.max(0, mid - intrinsic);
    const dte = daysBetween(todayISO, c.expiry);
    return {
      ...c,
      dte,
      mid,
      iv,
      delta,
      computedGreeks: computed,
      intrinsic,
      extrinsic,
      breakeven: c.strike + mid,
      breakevenPct: (c.strike + mid) / S * 100 - 100,
      extrinsicPctOfPremium: mid > 0 ? (extrinsic / mid) * 100 : null,
      extrinsicPerYearPct: mid > 0 ? (extrinsic / S) * 100 / (dte / 365) : null,
      spreadPct: c.bid > 0 && c.ask > 0 ? ((c.ask - c.bid) / mid) * 100 : null,
    };
  });
}

const W = { pass: 0, warn: 1, fail: 3, info: 0 };

export function gradeTime(dte) {
  return dte >= 365 ? "pass" : dte >= 270 ? "warn" : "fail";
}
export function gradeDelta(d) {
  if (d == null) return "fail";
  return d >= 0.75 && d <= 0.85 ? "pass" : d >= 0.7 && d <= 0.9 ? "warn" : "fail";
}
export function gradeBreakeven(pct) {
  return pct <= 15 ? "pass" : pct <= 20 ? "warn" : "fail";
}
export function gradeLiquidity(spreadPct, oi) {
  if (spreadPct == null) return "fail";
  const s = spreadPct <= 5 ? "pass" : spreadPct <= 10 ? "warn" : "fail";
  const o = oi >= 100 ? "pass" : oi >= 25 ? "warn" : "fail";
  return worst(s, o);
}

export function worst(...states) {
  const order = ["pass", "info", "warn", "fail"];
  return states.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a), "pass");
}

export function rankCandidates(enriched) {
  const pool = enriched.filter(
    (c) => c.dte >= 270 && c.bid > 0 && c.ask > 0 && c.delta != null && c.delta >= 0.65 && c.delta <= 0.95
  );
  for (const c of pool) {
    c.grades = {
      time: gradeTime(c.dte),
      delta: gradeDelta(c.delta),
      breakeven: gradeBreakeven(c.breakevenPct),
      liquidity: gradeLiquidity(c.spreadPct, c.oi),
    };
    const g = c.grades;
    c.score =
      (W[g.time] + W[g.delta] + W[g.breakeven] + W[g.liquidity]) * 10 +
      (c.extrinsicPerYearPct ?? 50) +
      (c.spreadPct ?? 50) * 0.3 +
      Math.abs(c.delta - 0.8) * 20 +
      (c.dte < 450 ? (450 - c.dte) / 60 : 0) +
      (c.dte > 800 ? (c.dte - 800) / 200 : 0);
  }
  return pool.sort((a, b) => a.score - b.score);
}

// ---------- the eight checks ----------

const fmt$ = (x) =>
  x == null ? "n/a" : "$" + x.toLocaleString("en-US", { minimumFractionDigits: x >= 1000 ? 0 : 2, maximumFractionDigits: x >= 1000 ? 0 : 2 });
const fmtPct = (x, d = 1) => (x == null ? "n/a" : (x >= 0 ? "+" : "") + x.toFixed(d) + "%");
const fmtDate = (iso) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function stockQuality(data, trend) {
  const items = [];
  let trendState = "info";
  if (trend && trend.sma200 != null) {
    const above200 = trend.price > trend.sma200;
    const golden = trend.sma50 > trend.sma200;
    if (above200 && golden) {
      trendState = "pass";
      items.push(`Uptrend: price ${fmt$(trend.price)} is above the 200-day average (${fmt$(trend.sma200)}) and the 50-day is above the 200-day.`);
    } else if (!above200 && !golden && trend.price < trend.sma50) {
      trendState = "fail";
      items.push(`Downtrend: price is below its 50-day (${fmt$(trend.sma50)}) and 200-day (${fmt$(trend.sma200)}) averages.`);
    } else {
      trendState = "warn";
      const bottoming = trend.price > trend.sma50 && trend.sma50Rising;
      items.push(
        bottoming
          ? `Possible bottom: price is back above a rising 50-day average (${fmt$(trend.sma50)}), but the trend isn't confirmed above the 200-day (${fmt$(trend.sma200)}).`
          : `Mixed trend: 50-day ${fmt$(trend.sma50)}, 200-day ${fmt$(trend.sma200)}, price ${fmt$(trend.price)}.`
      );
    }
    items.push(`52-week range ${fmt$(trend.low52)} to ${fmt$(trend.high52)}; price is ${fmtPct(trend.fromHighPct)} from the high.` + (trend.ret1y != null ? ` 1-year return ${fmtPct(trend.ret1y)}.` : ""));
  } else if (trend) {
    trendState = trend.price > trend.sma50 ? "warn" : "fail";
    items.push(`Less than 200 days of history. Price vs 50-day average: ${fmt$(trend.price)} vs ${fmt$(trend.sma50)}.`);
  } else {
    items.push("No price history, so the trend couldn't be checked.");
  }

  const f = data.fundamentals;
  const fund = f && !data.isIndex && f.quoteType !== "ETF" && f.quoteType !== "INDEX" && f.quoteType !== "MUTUALFUND";
  let fundState = "info";
  if (fund) {
    let good = 0, bad = 0;
    if (f.revenueGrowth != null) {
      const g = f.revenueGrowth * 100;
      if (g >= 10) good++;
      else if (g < 0) bad++;
      items.push(`Revenue growth ${fmtPct(g)} year over year.`);
    }
    if (f.profitMargin != null) {
      if (f.profitMargin > 0) good++;
      else bad++;
      items.push(`Profit margin ${fmtPct(f.profitMargin * 100)}.`);
    }
    if (f.freeCashflow != null) {
      if (f.freeCashflow > 0) good++;
      else bad++;
      items.push(`Free cash flow ${f.freeCashflow > 0 ? "positive" : "negative"}.`);
    }
    if (f.recommendationMean != null) {
      if (f.recommendationMean <= 2.5) good++;
      else if (f.recommendationMean > 3.5) bad++;
      items.push(
        `Analysts: ${f.recommendationKey ? f.recommendationKey.replace(/_/g, " ") : "rated"} (${f.recommendationMean.toFixed(1)} on a 1 to 5 scale${f.analystCount ? `, ${f.analystCount} analysts` : ""})` +
          (f.targetMean ? `, mean target ${fmt$(f.targetMean)}.` : ".")
      );
    }
    fundState = bad >= 2 && good <= 1 ? "fail" : bad >= 1 || good < 2 ? "warn" : "pass";
  } else if (data.isIndex || (f && (f.quoteType === "ETF" || f.quoteType === "INDEX"))) {
    items.push("Index or ETF: judged on trend only.");
  } else {
    items.push("Fundamentals weren't available, so this is judged on trend only. Check the business yourself.");
  }

  let state;
  if (fundState === "info") state = trendState === "info" ? "warn" : trendState;
  else if (trendState === "fail" && fundState === "fail") state = "fail";
  else if (trendState === "pass" && fundState === "pass") state = "pass";
  else if (trendState === "fail" || fundState === "fail") state = "warn";
  else state = worst(trendState, fundState);
  return { state, items, trendState, fundState };
}

export function analyze(data, settings = {}) {
  const S = data.price;
  const today = data.today;
  const trend = trendInfo(data.history || [], S);
  const ivc = ivContext(data.iv30, data.history || []);
  const enriched = enrichCalls(data.calls || [], S, today);
  const allRanked = rankCandidates(enriched);
  const ranked = settings.maxCost > 0 ? allRanked.filter((c) => c.mid * 100 <= settings.maxCost) : allRanked;
  const best = ranked[0] || null;

  const checks = [];
  const add = (id, title, target, state, summary, details = []) => checks.push({ id, title, target, state, summary, details });

  const maxDte = enriched.length ? Math.max(...enriched.map((c) => c.dte)) : null;

  // 1. time
  if (best) {
    add(1, "Time to expiry", "12 to 24+ months", best.grades.time,
      `${best.dte} days (${(best.dte / 30.44).toFixed(1)} months) to ${fmtDate(best.expiry)}.`,
      [`Plan to sell or roll by ${fmtDate(addDays(best.expiry, -270))}, about 9 months before expiry.`]);
  } else {
    add(1, "Time to expiry", "12 to 24+ months", maxDte != null && maxDte >= 365 ? "warn" : "fail",
      maxDte != null ? `Longest call expiry is ${maxDte} days out.` : "No call options 8+ months out are listed.",
      maxDte != null && maxDte >= 365 ? ["LEAPS expiries exist, but none had a usable deep in-the-money quote."] : ["This ticker has no LEAPS expiries."]);
  }

  // 2. delta
  if (best) {
    add(2, "Delta", "0.75 to 0.85", best.grades.delta,
      `Delta ${best.delta.toFixed(2)} at the $${best.strike} strike: the call moves about ${fmt$(best.delta)} per $1 in the stock.`,
      best.computedGreeks ? ["Delta computed from the option price (Black-Scholes), because the quote had no Greeks."] : []);
  } else {
    add(2, "Delta", "0.75 to 0.85", "fail", "No LEAPS call with a delta between 0.65 and 0.95 and a live two-sided quote.");
  }

  // 3. break-even / extrinsic
  if (best) {
    add(3, "Break-even and extrinsic value", "Break-even within 10 to 15% of price", best.grades.breakeven,
      `Break-even ${fmt$(best.breakeven)}, ${fmtPct(best.breakevenPct)} above today's ${fmt$(S)}.`,
      [`Premium ${fmt$(best.mid)} = intrinsic ${fmt$(best.intrinsic)} + extrinsic ${fmt$(best.extrinsic)} (${best.extrinsicPctOfPremium.toFixed(0)}% of premium).`,
       `Time cost: about ${best.extrinsicPerYearPct.toFixed(1)}% of the stock price per year.`]);
  } else {
    add(3, "Break-even and extrinsic value", "Break-even within 10 to 15% of price", "fail", "No qualifying contract to measure.");
  }

  // 4. IV + earnings
  {
    const details = [];
    let ivState = "info";
    if (ivc.ratio != null) {
      ivState = ivc.ratio <= 1.15 ? "pass" : ivc.ratio <= 1.4 ? "warn" : "fail";
      details.push(`30-day IV ${ivc.iv30.toFixed(1)}% vs the stock's own 1-year realized volatility ${ivc.hv1y.toFixed(1)}% (ratio ${ivc.ratio.toFixed(2)}).`);
      if (ivc.pctile != null) details.push(`IV is above ${ivc.pctile.toFixed(0)}% of the past year's 30-day realized-volatility readings (an IV-rank estimate).`);
    } else if (ivc.iv30 != null) {
      details.push(`30-day IV ${ivc.iv30.toFixed(1)}%. Not enough history to compare it with the stock's normal range.`);
    }
    if (best && best.iv) details.push(`The chosen contract's IV is ${(best.iv * 100).toFixed(1)}%.`);

    let earnState = "info";
    const ed = settings.earningsOverride || (data.earnings && data.earnings.date);
    if (ed) {
      const dn = daysBetween(today, ed);
      if (dn >= 0 && dn <= 14) {
        earnState = "fail";
        details.unshift(`Earnings on ${fmtDate(ed)}, in ${dn} day${dn === 1 ? "" : "s"}. IV usually drops right after the report, so buying now pays for volatility you'll likely lose.`);
      } else if (dn > 14 && dn <= 30) {
        earnState = "warn";
        details.unshift(`Earnings on ${fmtDate(ed)}, in ${dn} days.`);
      } else if (dn > 30) {
        earnState = "pass";
        details.unshift(`Next earnings ${fmtDate(ed)} (${dn} days away).`);
      }
    } else if (!data.isIndex) {
      details.unshift("Next earnings date not found. Look it up and enter it below before buying.");
      earnState = "warn";
    }
    const state = worst(ivState === "info" ? "pass" : ivState, earnState === "info" ? "pass" : earnState);
    const summary =
      earnState === "fail" ? "Earnings are close. Wait until after the report."
      : ivState === "fail" ? "Options are priced well above the stock's normal volatility."
      : ivState === "warn" ? "IV is somewhat elevated versus normal."
      : earnState === "warn" ? (ed ? "Earnings within a month; buying after the report is usually cheaper." : "Earnings date unknown.")
      : ivState === "pass" ? "IV is near or below the stock's normal volatility."
      : "IV couldn't be compared with history.";
    add(4, "Implied volatility", "IV low or normal, no earnings soon", state, summary, details);
    checks[3].ivState = ivState;
    checks[3].earnState = earnState;
  }

  // 5. liquidity
  if (best) {
    add(5, "Liquidity", "Spread under 5%, open interest in the hundreds", best.grades.liquidity,
      `Bid ${fmt$(best.bid)} / ask ${fmt$(best.ask)}: spread ${best.spreadPct.toFixed(1)}% of mid. Open interest ${best.oi.toLocaleString("en-US")}.`,
      [`Use a limit order near the mid, ${fmt$(best.mid)}.`]);
  } else {
    add(5, "Liquidity", "Spread under 5%, open interest in the hundreds", "fail", "No LEAPS call with a live bid and ask in the target range.");
  }

  // 6. the stock
  const q = stockQuality(data, trend);
  add(6, "The stock itself", "Quality business, uptrend or clear bottom", q.state,
    q.state === "pass" ? "Healthy trend and solid business numbers."
      : q.state === "fail" ? "Weak trend and weak business numbers."
      : "Some concerns. Make sure you'd own the shares anyway.",
    q.items);

  // 7. position size
  {
    const contracts = Math.max(1, settings.contracts || 1);
    const pv = settings.portfolio;
    if (!best) add(7, "Position size", "2 to 5% of portfolio", "info", "No contract to size.");
    else {
      const cost = best.mid * 100 * contracts;
      if (pv > 0) {
        const pct = (cost / pv) * 100;
        const maxN = Math.floor((pv * 0.05) / (best.mid * 100));
        add(7, "Position size", "2 to 5% of portfolio", pct <= 5 ? "pass" : pct <= 8 ? "warn" : "fail",
          `${contracts} contract${contracts > 1 ? "s" : ""} cost${contracts > 1 ? "" : "s"} ${fmt$(cost)}, ${pct.toFixed(1)}% of your ${fmt$(pv)} portfolio.`,
          [maxN >= 1 ? `At 5% you could hold up to ${maxN} contract${maxN > 1 ? "s" : ""}.` : `Even one contract is more than 5% of this portfolio.`]);
      } else {
        add(7, "Position size", "2 to 5% of portfolio", "info",
          `One contract costs ${fmt$(best.mid * 100)} (100 shares × ${fmt$(best.mid)}).`,
          [`That fits a 5% slice of a portfolio of ${fmt$(best.mid * 100 / 0.05)} or more. Enter your portfolio value to score this.`]);
      }
    }
  }

  // 8. exit plan
  if (best) {
    const roll = addDays(best.expiry, -270);
    add(8, "Exit plan", "Set before you buy", "info",
      `Take profit at ${fmt$(best.mid * 1.5)} (+50%) or ${fmt$(best.mid * 2)} (+100%). Cut at ${fmt$(best.mid * 0.6)} (−40%).`,
      [`Sell or roll by ${fmtDate(roll)}.`, "Also exit if your reason for owning the stock breaks."]);
  } else {
    add(8, "Exit plan", "Set before you buy", "info", "No contract to plan around.");
  }

  return {
    checks, best, alternatives: pickAlternatives(ranked, best), trend, ivc,
    projection: projection(data, best),
    overBudget: settings.maxCost > 0 && !best && allRanked.length > 0,
    verdict: verdict(checks, best, data),
  };
}

// Projected outcome at expiry if the stock reaches the analysts' mean target
// (or, with no target, grows 10% a year). Used to rank ideas; not a forecast.
export function projection(data, best) {
  if (!best) return null;
  const f = data.fundamentals || {};
  const S = data.price;
  const years = best.dte / 365;
  const hasTarget = f.targetMean > 0 && !data.isIndex && f.quoteType !== "ETF";
  const target = hasTarget ? f.targetMean : S * Math.pow(1.1, years);
  const value = Math.max(0, target - best.strike);
  const optionReturn = (value / best.mid - 1) * 100;
  return {
    basis: hasTarget ? "analyst target" : "10% a year",
    target,
    stockReturn: (target / S - 1) * 100,
    optionReturn,
    annualized: optionReturn > -100 ? (Math.pow(1 + optionReturn / 100, 1 / Math.max(years, 0.5)) - 1) * 100 : -100,
  };
}

function pickAlternatives(ranked, best) {
  const out = [];
  const seen = new Set();
  for (const c of ranked) {
    if (c === best || seen.has(c.expiry)) continue;
    seen.add(c.expiry);
    out.push(c);
  }
  for (const c of ranked) {
    if (out.length >= 6) break;
    if (c !== best && !out.includes(c)) out.push(c);
  }
  return out.slice(0, 6);
}

export function verdict(checks, best, data) {
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  const noGo = [], wait = [], cautions = [];

  if (!best) noGo.push("No LEAPS call fits: there's no deep in-the-money contract 9+ months out with a live quote.");
  for (const id of [1, 2, 3, 5, 6]) {
    const c = by[id];
    if (!best && id !== 6) continue;
    if (c.state === "fail") noGo.push(`${c.title}: ${c.summary}`);
    else if (c.state === "warn") cautions.push(`${c.title}: ${c.summary}`);
  }
  const iv = by[4];
  if (iv.earnState === "fail") wait.push(iv.summary);
  else if (iv.ivState === "fail") wait.push("Options are expensive right now (IV well above normal). Wait for IV to cool.");
  else if (iv.state === "warn") cautions.push(`${iv.title}: ${iv.summary}`);
  if (by[7].state === "fail") cautions.push(`Position size: ${by[7].summary} Buy fewer contracts.`);

  let level, headline;
  if (noGo.length) {
    level = "nogo";
    headline = `No-go on ${data.ticker} LEAPS for now`;
  } else if (wait.length || cautions.length >= 3) {
    level = "wait";
    headline = `Wait on ${data.ticker}`;
  } else {
    level = "go";
    headline = cautions.length ? `Go on ${data.ticker}, with care` : `Go on ${data.ticker}`;
  }
  return { level, headline, reasons: [...noGo, ...wait, ...cautions] };
}
