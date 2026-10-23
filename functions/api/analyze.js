// Cloudflare Pages Function: GET /api/analyze?ticker=SOFI
import { cleanTicker, gatherData } from "../_lib/data.js";

const CACHE_SECONDS = 300;

export async function onRequestGet({ request, waitUntil }) {
  const url = new URL(request.url);
  const ticker = cleanTicker(url.searchParams.get("ticker"));
  if (!ticker) return json({ ok: false, error: "Enter a valid ticker, like SOFI or AAPL." }, 400);

  const cache = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request(`${url.origin}/api/analyze?ticker=${ticker}`);
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  let body;
  try {
    body = await gatherData(ticker);
  } catch (e) {
    body = { ok: false, ticker, error: `Data fetch failed: ${e.message}` };
  }
  const res = json(body, body.ok ? 200 : 502, body.ok ? CACHE_SECONDS : 30);
  if (cache && body.ok) waitUntil(cache.put(key, res.clone()));
  return res;
}

function json(obj, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
}
