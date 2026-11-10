// GET /api/contract?ticker=SOFI&expiry=2027-01-15 -> { ok, price, calls: [{ strike, bid, ask, iv, delta, oi, symbol }] }
// The quotes for one expiry, so the page can check a call the user already owns (any time to expiry).
import { fetchContracts } from "../_lib/data.js";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  let body;
  try {
    body = await fetchContracts(url.searchParams.get("ticker"), url.searchParams.get("expiry"));
  } catch (e) {
    body = { ok: false, error: `Couldn't load the option quotes (${e.message}). Try again in a minute.` };
  }
  return new Response(JSON.stringify(body), {
    status: 200, // the page reads body.ok
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${body.ok ? 60 : 0}` },
  });
}
