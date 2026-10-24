// Cloudflare Workers entry: static files come from public/ (assets), /api/* runs the data functions.
import { onRequestGet as analyze } from "../functions/api/analyze.js";
import { onRequestGet as quotes } from "../functions/api/quotes.js";
import { onRequestGet as search } from "../functions/api/search.js";

const ROUTES = { "/api/analyze": analyze, "/api/quotes": quotes, "/api/search": search };

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
};
