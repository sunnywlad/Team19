// Règles de lint de sécurité du dashboard. Échoue (code 1) à la première
// infraction. Volontairement sans dépendance : des motifs interdits, cherchés
// dans les sources. Chaque règle dit pourquoi elle existe.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Usage : node tools/lint.mjs [racine]. La racine n'est passée que par les tests.
const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));

const EVERYWHERE = [
  [/dangerouslySetInnerHTML/, "dangerouslySetInnerHTML interdit : une donnée d'API ne devient jamais du HTML"],
  [/\b(innerHTML|outerHTML|insertAdjacentHTML|srcdoc)\b/, "injection de HTML interdite (innerHTML et apparentés)"],
  [/document\.write|\beval\s*\(|new Function\b|\bsetTimeout\s*\(\s*["'`]/, "évaluation de code interdite"],
  [/\bVITE_[A-Z0-9_]+/, "aucune variable VITE_* : elles finissent dans le bundle, donc publiques"],
];

const APP_ONLY = [
  [/import\.meta\.env/, "aucune lecture d'environnement dans le bundle : la configuration vit dans le proxy"],
  [/\bstyle\s*=\s*\{/, "aucun style en attribut : la CSP n'autorise que la feuille de style"],
  [/\b(href|src|action|formAction|srcSet|poster)\s*=\s*\{/, "aucune URL construite à partir de données"],
  [/\b(XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/, "seul fetch, en GET, parle au réseau (src/api/http.ts)"],
  [/\bmethod\s*:\s*["'`](?!GET["'`])/, "lecture seule : aucune méthode HTTP autre que GET"],
  [/https?:\/\/(?!www\.w3\.org\/)/, "aucune ressource externe : pas d'URL absolue dans l'application"],
  [/<\s*(form|iframe|object|embed|script)\b/, "balise interdite dans l'application"],
];

const FETCH_ALLOWED = new Set(["src/api/http.ts", "src/api/client.ts"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "generated") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|css|html)$/.test(name)) out.push(path);
  }
  return out;
}

const files = [...walk(join(root, "src")), ...walk(join(root, "fixtures")), join(root, "index.html"), join(root, "vite.config.ts")].filter((file) =>
  existsSync(file),
);
const failures = [];

for (const file of files) {
  const rel = relative(root, file);
  const inApp = rel.startsWith("src/") || rel === "index.html";
  const rules = inApp ? [...EVERYWHERE, ...APP_ONLY] : EVERYWHERE;
  readFileSync(file, "utf8").split("\n").forEach((line, index) => {
    for (const [pattern, why] of rules) {
      // index.html : la seule balise script est le point d'entrée local.
      if (rel === "index.html" && pattern.source.includes("script") && /<script type="module" src="\/src\/main\.tsx">/.test(line)) continue;
      if (pattern.test(line)) failures.push(`${rel}:${index + 1} : ${why}`);
    }
    if (inApp && /\bfetch\s*\(/.test(line) && !FETCH_ALLOWED.has(rel)) failures.push(`${rel}:${index + 1} : fetch hors de src/api`);
  });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`lint : ${failures.length} infraction(s)`);
  process.exit(1);
}
console.log(`lint : ${files.length} fichiers, aucune infraction`);
