// Turns one stock from the nightly scan file (public/data/scan.json) back into the shape analyze() takes.
export function fromSnapshot(ticker, s, todayISO) {
  return {
    ok: true,
    ticker,
    isIndex: !!s.isIndex,
    asOf: s.asOf,
    today: todayISO,
    price: s.price,
    changePct: s.changePct,
    iv30: s.iv30,
    lastExpiry: s.lastExpiry,
    earnings: s.earnings || { date: null, source: null },
    fundamentals: s.fundamentals,
    history: (s.closes || []).map((c) => ({ c })),
    calls: (s.calls || []).map(([expiry, strike, bid, ask, iv, delta, oi, symbol]) => ({ expiry, strike, bid, ask, iv, delta, oi, symbol, last: null })),
    notes: [],
  };
}

// The snapshot is fresh enough to rank ideas if it is at most this many days old (covers weekends and holidays).
export const SNAPSHOT_MAX_AGE_DAYS = 5;
