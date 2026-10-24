// Local preview: serves public/ and answers /api/analyze from fixtures (no network).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { onRequestGet } from "../functions/api/analyze.js";
import { onRequestGet as quotesHandler } from "../functions/api/quotes.js";
import { onRequestGet as searchHandler } from "../functions/api/search.js";
import { mockFetch } from "./fixtures.mjs";

globalThis.fetch = mockFetch();
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const h = { "/api/analyze": onRequestGet, "/api/quotes": quotesHandler, "/api/search": searchHandler }[url.pathname];
  if (h) {
    const r = await h({ request: new Request(url), waitUntil() {} });
    res.writeHead(r.status, { "content-type": "application/json" });
    return res.end(await r.text());
  }
  const p = join("public", url.pathname === "/" ? "index.html" : url.pathname);
  try { res.writeHead(200, { "content-type": types[extname(p)] || "text/plain" }); res.end(await readFile(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(process.env.PORT || 8788);
