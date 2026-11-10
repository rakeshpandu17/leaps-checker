// Cloudflare Pages Function: GET /api/chart?ticker=SOFI&range=1d|5d -> { ok, points: [{ t, c }], prevClose, price }
import { fetchChart } from "../_lib/data.js";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  let body;
  try {
    body = await fetchChart(url.searchParams.get("ticker"), url.searchParams.get("range"));
  } catch (e) {
    body = { ok: false, error: `Chart failed: ${e.message}` };
  }
  return new Response(JSON.stringify(body), {
    status: body.ok ? 200 : 502,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${body.ok ? 60 : 0}` },
  });
}
