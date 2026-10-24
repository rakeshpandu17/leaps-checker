// Cloudflare Pages Function: GET /api/search?q=sofi -> { results: [{ symbol, name, type, exchange }] }
import { searchTickers } from "../_lib/data.js";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  let body;
  try {
    body = await searchTickers(url.searchParams.get("q"));
  } catch (e) {
    body = { ok: false, results: [], error: `Search failed: ${e.message}` };
  }
  return new Response(JSON.stringify(body), {
    status: body.ok ? 200 : 502,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${body.ok ? 86400 : 0}` },
  });
}
