// Cloudflare Workers entry: static files come from public/ (assets), /api/* runs the data functions.
import { onRequestGet as analyze } from "../functions/api/analyze.js";
import { onRequestGet as quotes } from "../functions/api/quotes.js";
import { onRequestGet as search } from "../functions/api/search.js";

const ROUTES = { "/api/analyze": analyze, "/api/quotes": quotes, "/api/search": search };

// The scan runs as a GitHub Actions workflow. GitHub often starts scheduled runs hours late, so a Cloudflare
// Cron Trigger (see "triggers" in wrangler.jsonc) asks GitHub to start it on time. Needs the GITHUB_TOKEN secret:
// a fine-grained token for this repository with "Actions: Read and write".
const REPO = "rakeshpandu17/leaps-checker";
const WORKFLOW = "nightly-scan.yml";

export async function dispatchScan(env, fetchFn = fetch) {
  if (!env.GITHUB_TOKEN) {
    console.log("GITHUB_TOKEN secret is not set; skipping the scan dispatch.");
    return { ok: false, status: 0 };
  }
  const r = await fetchFn(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "leaps-checker-cron",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (r.status !== 204) console.log(`Scan dispatch failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  else console.log("Scan dispatched.");
  return { ok: r.status === 204, status: r.status };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const handler = ROUTES[url.pathname];
    if (handler) {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      return handler({ request, waitUntil: (p) => ctx.waitUntil(p) });
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchScan(env));
  },
};
