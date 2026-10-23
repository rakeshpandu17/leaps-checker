# LEAPS Go/No-Go

Type a ticker, get a go / wait / no-go check for buying a LEAPS call, scored on eight rules:
time to expiry, delta, break-even and extrinsic value, implied volatility and earnings timing,
liquidity, stock quality and trend, position size, and an exit plan.

Educational only, not financial advice.

## How it works

- `functions/api/analyze.js` is a Cloudflare Pages Function (`GET /api/analyze?ticker=SOFI`).
  It fetches free data server side and caches each ticker for 5 minutes:
  - Cboe delayed quotes: stock price, 30-day IV, full option chain with Greeks, daily price history.
  - Yahoo Finance quoteSummary: earnings date, revenue growth, margins, analyst view.
  - Nasdaq: earnings date fallback.
- `public/scoring.js` does all the scoring in the browser: picks the best deep in-the-money call
  9+ months out, grades the eight checks, and builds the verdict.
- `public/index.html` + `app.js` + `styles.css` are the page.

Data limits: quotes are about 15 minutes delayed; free sources have no IV history, so "IV rank" is
estimated by comparing today's 30-day IV with the stock's own realized volatility over the past year.
If Yahoo or Nasdaq don't answer, the page says so and lets you type the earnings date in.

## Deploy (free, Cloudflare Pages)

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo.
2. Framework preset: None. Build command: leave empty. Build output directory: `public`.
3. Save and Deploy. The site is at `https://<project>.pages.dev`; every push to `main` redeploys.

## Develop

    npm test                     # offline tests with fixture data
    node test/serve-mock.mjs     # local preview at http://localhost:8788 using fixture data
    npx wrangler pages dev public  # local preview against live data
