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

## Deploy (free, Cloudflare)

Works as either a Cloudflare Worker (uses `wrangler.jsonc` + `src/worker.js`) or a Pages site.

**As a Worker:** Compute → Workers & Pages → Create → Import a repository → pick this repo, keep the default deploy command (`npx wrangler deploy`). The Worker name must match `name` in `wrangler.jsonc` (currently `leaps-startegy-checker`).

**As Pages:**

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick this repo.
2. Framework preset: None. Build command: leave empty. Build output directory: `public`.
3. Save and Deploy. The site is at `https://<project>.pages.dev`; every push to `main` redeploys.

## Develop

    npm test                     # offline tests with fixture data
    node test/serve-mock.mjs     # local preview at http://localhost:8788 using fixture data
    npx wrangler pages dev public  # local preview against live data

## Nightly scan

`.github/workflows/nightly-scan.yml` runs `scripts/nightly-scan.mjs` twice each weekday, at 15:00 UTC (mid-morning, while option quotes are tight) and 23:00 UTC (evening, after most after-the-close earnings reports). GitHub often starts scheduled runs late, so the Worker's Cron Triggers (`triggers` in `wrangler.jsonc`) start the workflow on time through the GitHub API. Add a Worker secret named `GITHUB_TOKEN`: a fine-grained token for this repository with "Actions: Read and write". GitHub's own schedule stays as a backup and skips itself when a scan finished in the last 3 hours.
It fetches data for about 330 tickers in `scripts/scan-universe.mjs` and commits a compact snapshot to
`public/data/scan.json`; the push redeploys the site. The "LEAPS ideas" list ranks that snapshot in the browser
(falling back to a live scan of `public/universe.js` if the snapshot is missing or over 5 days old).
Run it any time from GitHub → Actions → Nightly LEAPS scan → Run workflow.
