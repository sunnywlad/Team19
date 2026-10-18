// Prévisualisation locale fidèle à Vercel : URL propres, en-têtes de vercel.json
// (dont la CSP) et page 404. Sans dépendance. Usage : node site/tools/serve.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.argv[2] ?? 4173);
const config = JSON.parse(await readFile(join(RACINE, "vercel.json"), "utf8"));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".json": "application/json",
};
// Fichiers servis par Vercel : tout sauf ce que liste .vercelignore.
const ignores = (await readFile(join(RACINE, ".vercelignore"), "utf8")).split("\n").filter(Boolean);
const ignore = (rel) => ignores.some((m) => (m.endsWith("/") ? rel.startsWith(m) : rel === m));

async function fichier(chemin) {
  const abs = normalize(join(RACINE, chemin));
  if (abs !== RACINE && !abs.startsWith(RACINE + sep)) return null;
  if (ignore(abs.slice(RACINE.length + 1))) return null;
  try { return (await stat(abs)).isFile() ? abs : null; } catch { return null; }
}

function enTetes(url) {
  const h = {};
  for (const regle of config.headers ?? []) {
    const motif = new RegExp("^" + regle.source.replace(/\(\.\*\)/g, "(.*)") + "$");
    if (motif.test(url)) for (const { key, value } of regle.headers) h[key] = value;
  }
  return h;
}

createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (config.trailingSlash === false && url.length > 1 && url.endsWith("/")) {
    res.writeHead(308, { Location: url.slice(0, -1) }); res.end(); return;
  }
  if (config.cleanUrls && url.endsWith(".html")) {
    const propre = url.slice(0, -5).replace(/\/index$/, "/") || "/";
    res.writeHead(308, { Location: propre }); res.end(); return;
  }
  let abs = url === "/" ? await fichier("index.html") : (await fichier(url)) ?? (config.cleanUrls ? await fichier(url + ".html") : null);
  let statut = 200;
  if (!abs) { abs = await fichier("404.html"); statut = 404; }
  const corps = await readFile(abs);
  res.writeHead(statut, { "Content-Type": TYPES[extname(abs)] ?? "application/octet-stream", ...enTetes(url) });
  res.end(corps);
}).listen(PORT, "127.0.0.1", () => console.log(`site : http://127.0.0.1:${PORT}`));
