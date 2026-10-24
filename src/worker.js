// Cloudflare Workers entry: static files come from public/ (assets), /api/analyze runs the data function.
import { onRequestGet } from "../functions/api/analyze.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/analyze") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      return onRequestGet({ request, waitUntil: (p) => ctx.waitUntil(p) });
    }
    return env.ASSETS.fetch(request);
  },
};
