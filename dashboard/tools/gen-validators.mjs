// Précompile les validateurs ajv (code autonome) dans src/generated/.
// Pourquoi : ajv compile ses validateurs avec « new Function », que la CSP du
// dashboard interdit (pas de 'unsafe-eval'). Le code généré n'évalue rien.
// Sources : specs/schemas (journal, incident, gelés) et dashboard/schemas
// (formes de l'API du relais, dérivées de relay/src ; formes proposées).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020").default;
const standaloneCode = require("ajv/dist/standalone").default;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const specs = resolve(root, "../specs/schemas");
const local = join(root, "schemas");
const out = join(root, "src/generated");

const EXPORTS = {
  incidentReport: "urn:argent-intelligent:schema:incident-report:1",
  journalEntry: "urn:argent-intelligent:schema:journal-entry:1",
  relayDecisions: "urn:argent-intelligent:dashboard:relay-decisions:1",
  relayEvents: "urn:argent-intelligent:dashboard:relay-events:1",
  relayQueue: "urn:argent-intelligent:dashboard:relay-queue:1",
  relayStatus: "urn:argent-intelligent:dashboard:relay-status:1",
  vaultState: "urn:argent-intelligent:dashboard:vault-state:1",
  incidents: "urn:argent-intelligent:dashboard:response-incidents:1",
  journalEntries: "urn:argent-intelligent:dashboard:response-journal-entries:1",
  journalVerification: "urn:argent-intelligent:dashboard:response-journal-verification:1",
  pausedAgents: "urn:argent-intelligent:dashboard:response-paused-agents:1",
};

const ajv = new Ajv2020({ strict: true, allErrors: false, code: { source: true, esm: true } });
const load = (file) => JSON.parse(readFileSync(file, "utf8"));
for (const name of ["incident-report.schema.json", "journal-entry.schema.json"]) ajv.addSchema(load(join(specs, name)));
for (const name of readdirSync(local).filter((f) => f.endsWith(".schema.json")).sort()) ajv.addSchema(load(join(local, name)));

// Les deux seules fonctions d'exécution d'ajv dont le code généré a besoin
// sont réécrites ici : pas de require() dans un module du navigateur.
const RUNTIME = `
function __equal(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!__equal(a[i], b[i])) return false;
      return true;
    }
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const k of keys) if (!Object.prototype.hasOwnProperty.call(b, k) || !__equal(a[k], b[k])) return false;
    return true;
  }
  return a !== a && b !== b;
}
function __ucs2length(str) {
  let length = 0;
  for (const _ of str) length++;
  return length;
}
`;

let code = standaloneCode(ajv, EXPORTS)
  .replaceAll('require("ajv/dist/runtime/equal").default', "__equal")
  .replaceAll('require("ajv/dist/runtime/ucs2length").default', "__ucs2length");
if (/\brequire\s*\(/.test(code)) throw new Error("gen-validators : dépendance d'exécution ajv non prise en charge");
if (/new Function|\beval\s*\(/.test(code)) throw new Error("gen-validators : le code généré évalue du code");
code = `// GÉNÉRÉ par tools/gen-validators.mjs. Ne pas modifier, ne pas committer.\n${RUNTIME}\n${code}\n`;

const types = `// GÉNÉRÉ par tools/gen-validators.mjs.
export type AjvError = { instancePath: string; keyword: string; message?: string };
export type AjvValidator = ((data: unknown) => boolean) & { errors?: AjvError[] | null };
${Object.keys(EXPORTS).map((name) => `export const ${name}: AjvValidator;`).join("\n")}
`;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "validators.js"), code);
writeFileSync(join(out, "validators.d.ts"), types);
