// Cloudflare Pages Function: GET /api/quotes?tickers=AAPL,MSFT,... (up to 40) -> { quotes: { AAPL: { price, iv30 } } }
import { gatherQuotes } from "../_lib/data.js";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const tickers = String(url.searchParams.get("tickers") || "").split(",");
  let body;
  try {
    body = await gatherQuotes(tickers);
  } catch (e) {
    body = { ok: false, error: `Quote fetch failed: ${e.message}` };
  }
  return new Response(JSON.stringify(body), {
    status: body.ok ? 200 : 502,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
