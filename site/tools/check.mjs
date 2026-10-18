// Contrôles du site public, sans dépendance. Usage : node site/tools/check.mjs
// Échoue (code 1) sur : lien interne cassé, URL externe non autorisée, script ou style en ligne,
// formulation interdite, page sans lang="fr", <title> ou meta description, bandeau de démo ou
// pastille « En construction » manquants, vercel.json différent de la demande.
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve, extname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const erreurs = [];
const infos = [];
const err = (f, m) => erreurs.push(`${f} : ${m}`);
const lire = (f) => readFile(join(RACINE, f), "utf8");

// ---------- Inventaire : ce que Vercel déploie (tout sauf .vercelignore) ----------
const ignores = (await lire(".vercelignore")).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
const ignore = (rel) => ignores.some((m) => (m.endsWith("/") ? rel.startsWith(m) : rel === m));
async function lister(dir) {
  const out = [];
  for (const e of await readdir(join(RACINE, dir), { withFileTypes: true })) {
    const rel = posix.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await lister(rel)));
    else out.push(rel);
  }
  return out;
}
const tous = (await lister("")).filter((f) => f !== ".vercelignore");
const deployes = tous.filter((f) => !ignore(f));
const TEXTE = new Set([".html", ".css", ".js", ".xml", ".txt", ".json", ".svg", ".md", ".mjs"]);
// Les fichiers tiers recopiés tels quels (licence des polices) ne sont pas les nôtres.
const nosTextes = tous.filter((f) => TEXTE.has(extname(f)) && !f.startsWith("fonts/"));
const textesDeployes = deployes.filter((f) => TEXTE.has(extname(f)) && !f.startsWith("fonts/"));
const contenu = Object.fromEntries(await Promise.all(nosTextes.map(async (f) => [f, await lire(f)])));

// ---------- Pages attendues ----------
const PAGES = ["index.html", "demo.html", "demo-console.html", "mentions-legales.html", "confidentialite.html", "404.html"];
for (const p of PAGES) if (!deployes.includes(p)) err(p, "page attendue absente");
const pagesHtml = deployes.filter((f) => f.endsWith(".html"));
for (const f of ["favicon.svg", "og.png", "robots.txt", "sitemap.xml", "config.js", "vercel.json", "fonts/LICENSE.txt"])
  if (!deployes.includes(f)) err(f, "fichier attendu absent");

// Une URL du site (« /demo », « /#risque », « /assets/site.css ») vers le fichier servi, comme Vercel avec cleanUrls.
function cible(chemin) {
  const p = decodeURIComponent(chemin.split(/[?#]/)[0]);
  if (p === "/" || p === "") return "index.html";
  const rel = p.replace(/^\//, "");
  if (deployes.includes(rel)) return rel;
  if (deployes.includes(rel + ".html")) return rel + ".html";
  return null;
}
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
// Vues de la console, routées par le fragment (#apercu, #valider…) : lues dans console.js.
const consoleJs = contenu["assets/console.js"] ?? "";
const vuesConsole = new Set([...(consoleJs.match(/const VUES = \{([^}]+)\}/)?.[1] ?? "").matchAll(/(\w+):/g)].map((m) => m[1]).concat("connexion"));

// ---------- Origine de production et URL externes autorisées ----------
const sitemap = contenu["sitemap.xml"] ?? "";
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const origine = locs.length ? new URL(locs[0]).origin : null;
if (!origine) err("sitemap.xml", "aucune URL <loc>");
for (const l of locs) {
  if (new URL(l).origin !== origine) err("sitemap.xml", `origine différente de la première URL : ${l}`);
  if (!cible(new URL(l).pathname)) err("sitemap.xml", `URL sans page : ${l}`);
}
if (origine?.includes("a-completer.invalid")) infos.push("URL de production encore à compléter (sitemap.xml, robots.txt, og:image).");

const config = contenu["config.js"] ?? "";
const rdv = config.match(/RDV_URL:\s*"([^"]*)"/)?.[1];
const mail = config.match(/CONTACT_EMAIL:\s*"([^"]*)"/)?.[1];
if (rdv === undefined) err("config.js", "RDV_URL absent");
if (mail === undefined) err("config.js", "CONTACT_EMAIL absent");
if (rdv?.includes("a-completer.invalid")) infos.push("config.js : RDV_URL encore à compléter.");
if (mail?.includes("a-completer.invalid")) infos.push("config.js : CONTACT_EMAIL encore à compléter.");
if (rdv && !rdv.startsWith("https://")) err("config.js", "RDV_URL doit être en https");

const AUTORISEES = [
  origine, // URL de production : sitemap, robots, og:image
  rdv, // lien de prise de rendez-vous, un seul endroit : config.js
  "http://www.w3.org/2000/svg", // espace de noms SVG (favicon), pas un lien
  "http://www.sitemaps.org/schemas/sitemap/0.9", // espace de noms du sitemap, pas un lien
].filter(Boolean);
for (const f of textesDeployes) {
  for (const m of contenu[f].matchAll(/https?:\/\/[^\s"'<>)`]+/g)) {
    const url = m[0].replace(/[.,;]+$/, "");
    if (!AUTORISEES.some((a) => url === a || url.startsWith(a.endsWith("/") ? a : a + "/") || url.startsWith(a + "#")))
      err(f, `URL externe non autorisée : ${url}`);
  }
}

// ---------- Pages HTML ----------
const contexteDe = (f, i) => f + " (ligne " + (contenu[f].slice(0, i).split("\n").length) + ")";
for (const f of pagesHtml) {
  const html = contenu[f];
  if (!/<html[^>]*\slang="fr"/.test(html)) err(f, 'lang="fr" absent');
  const titre = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
  if (!titre) err(f, "<title> absent ou vide");
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1]?.trim();
  if (!desc) err(f, "meta description absente ou vide");
  for (const p of ["og:title", "og:description", "og:image"])
    if (!new RegExp(`<meta property="${p}" content="[^"]+"`).test(html)) err(f, `${p} absent`);
  const og = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  if (og && origine && !og.startsWith(origine + "/")) err(f, `og:image hors de l'URL de production (${og})`);

  // Rien en ligne : la CSP le bloquerait.
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))
    if (!/\ssrc="/.test(m[1]) || m[2].trim()) err(contexteDe(f, m.index), "script en ligne");
  for (const m of html.matchAll(/<style\b/g)) err(contexteDe(f, m.index), "balise <style> en ligne");
  for (const m of html.matchAll(/\sstyle="/g)) err(contexteDe(f, m.index), "attribut style en ligne");
  for (const m of html.matchAll(/\son[a-z]+="/g)) err(contexteDe(f, m.index), "gestionnaire d'événement en ligne");
  if (/href="javascript:/i.test(html)) err(f, "lien javascript:");

  // Liens et ressources internes.
  const idsPage = ids(html);
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const v = m[1];
    if (/^(https?:|mailto:)/.test(v)) continue;
    if (v.startsWith("#")) {
      const id = v.slice(1);
      if (!idsPage.has(id) && !(f === "demo-console.html" && vuesConsole.has(id))) err(contexteDe(f, m.index), `ancre inexistante : ${v}`);
      continue;
    }
    if (!v.startsWith("/")) { err(contexteDe(f, m.index), `lien relatif à éviter (404 servie partout) : ${v}`); continue; }
    const t = cible(v);
    if (!t) { err(contexteDe(f, m.index), `lien interne vers une page inexistante : ${v}`); continue; }
    const frag = v.split("#")[1];
    if (frag && t.endsWith(".html") && !ids(contenu[t]).has(frag)) err(contexteDe(f, m.index), `ancre inexistante dans ${t} : #${frag}`);
  }
  // Liens sortants : jamais d'accès à la page d'origine ni de référent.
  for (const m of html.matchAll(/<a\b[^>]*href="https?:[^"]*"[^>]*>/g))
    if (!/rel="[^"]*noopener[^"]*"/.test(m[0]) || !/rel="[^"]*noreferrer[^"]*"/.test(m[0])) err(contexteDe(f, m.index), 'lien sortant sans rel="noopener noreferrer"');
}

// Scripts et feuilles de style : pas de style ni de gestionnaire en ligne dans le HTML produit par le JS.
for (const f of textesDeployes.filter((x) => x.endsWith(".js"))) {
  for (const m of contenu[f].matchAll(/style="|\son[a-z]+="/g)) err(contexteDe(f, m.index), "style ou gestionnaire en ligne dans du HTML généré");
  if (/\beval\(|new Function\(/.test(contenu[f])) err(f, "eval ou new Function (refusés par la CSP)");
}
for (const f of textesDeployes.filter((x) => x.endsWith(".css")))
  for (const m of contenu[f].matchAll(/url\("?([^")]+)"?\)/g)) if (!m[1].startsWith("data:") && !cible(m[1])) err(f, `url() introuvable : ${m[1]}`);

// ---------- Formulations interdites (tout site/, hors ce script) ----------
const INTERDITES = [
  [/prot[ée]g[ée]e?s? contre l['’]injection/i, "« protégé contre l'injection »"],
  [/z[ée]ro attaques? r[ée]ussies?/i, "« zéro attaque réussie »"],
  [/conform/i, "« conforme » (et dérivés)"],
  [/certifi/i, "« certifié » (et dérivés)"],
  [/z[ée]ro[- ]?days?/i, "« zero-day »"],
  [/anonymis/i, "« anonymisation »"],
];
for (const [f, texte] of Object.entries(contenu)) {
  if (f === "tools/check.mjs") continue;
  for (const [re, nom] of INTERDITES) for (const m of texte.matchAll(new RegExp(re, "gi"))) err(contexteDe(f, m.index), `formulation interdite ${nom}`);
  // « le contrat paie » n'est permis qu'avec « sur réseau de test » dans la même phrase.
  for (const m of texte.matchAll(/[^.!?\n]*\ble contrat (?:paie|a payé|paiera|payera)\b[^.!?\n]*/gi))
    if (!/sur r[ée]seau de test/i.test(m[0])) err(contexteDe(f, m.index), "« le contrat paie » sans « sur réseau de test »");
}

// ---------- Console de démo : bandeau et fonctions en construction ----------
const BANDEAU = "Démo interactive du produit cible · société et données fictives · certaines fonctions sont en construction";
const dc = contenu["demo-console.html"] ?? "";
const bandeau = dc.match(/<div class="bandeau-demo"[\s\S]*?<\/div>/)?.[0] ?? "";
if (!bandeau) err("demo-console.html", "bandeau de démo absent");
else {
  if (!bandeau.includes(BANDEAU)) err("demo-console.html", `texte du bandeau différent de : « ${BANDEAU} »`);
  if (!bandeau.includes('href="/#avancement"')) err("demo-console.html", "le bandeau ne mène pas à /#avancement");
  if (!bandeau.includes('href="/"')) err("demo-console.html", "le bandeau n'a pas de lien de retour vers /");
  if (dc.indexOf(bandeau) > dc.indexOf('<div class="app">')) err("demo-console.html", "le bandeau doit précéder la console");
}
const EN_CONSTRUCTION = ["nav-acces", "nav-mobile", "ecran-connexion", "ecran-mobile", "fournisseurs-erp"];
const sources = dc + "\n" + consoleJs;
const marques = [...sources.matchAll(/data-construction="([^"]+)"[^>]*>([\s\S]*?)<\/(?:a|div)>/g)];
for (const id of EN_CONSTRUCTION) if (!marques.some((m) => m[1] === id)) err("demo-console", `élément en construction non marqué : ${id}`);
for (const [, id, dedans] of marques)
  if (!/class="pastille p-construction"[^>]*>[\s\S]*?En construction<\/span>/.test(dedans)) err("demo-console", `${id} : pastille « En construction » absente`);
if (!consoleJs.includes("Aperçu d'une fonctionnalité en construction. La passkey est simulée.")) err("assets/console.js", "encadré de l'app d'approbation absent");

// ---------- vercel.json ----------
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
try {
  const v = JSON.parse(contenu["vercel.json"]);
  if (v.cleanUrls !== true) err("vercel.json", "cleanUrls doit valoir true");
  if (v.trailingSlash !== false) err("vercel.json", "trailingSlash doit valoir false");
  const tout = (v.headers ?? []).find((h) => h.source === "/(.*)")?.headers ?? [];
  const h = Object.fromEntries(tout.map((x) => [x.key.toLowerCase(), x.value]));
  const attendus = { "content-security-policy": CSP, "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "permissions-policy": "camera=(), microphone=(), geolocation=()" };
  for (const [k, val] of Object.entries(attendus)) if (h[k] !== val) err("vercel.json", `en-tête ${k} absent ou différent`);
} catch (e) { err("vercel.json", `JSON invalide : ${e.message}`); }

// ---------- Image Open Graph ----------
try {
  const png = await readFile(join(RACINE, "og.png"));
  if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) err("og.png", "dimensions attendues : 1200 × 630");
  if ((await stat(join(RACINE, "og.png"))).size > 600_000) err("og.png", "plus de 600 ko");
} catch { /* absence déjà signalée */ }

// ---------- Champs à compléter ----------
const aCompleter = Object.entries(contenu).filter(([f]) => f !== "tools/check.mjs" && f !== "README.md")
  .flatMap(([f, t]) => [...t.matchAll(/À COMPLÉTER/g)].map((m) => contexteDe(f, m.index)));
if (aCompleter.length) infos.push(`${aCompleter.length} marque(s) « À COMPLÉTER » : ${aCompleter.join(", ")}`);

for (const i of infos) console.log(`info   ${i}`);
if (erreurs.length) {
  for (const e of erreurs) console.error(`ERREUR ${e}`);
  console.error(`site : ${erreurs.length} erreur(s).`);
  process.exit(1);
}
console.log(`site : OK (${pagesHtml.length} pages, ${deployes.length} fichiers déployés).`);
