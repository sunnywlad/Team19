#!/usr/bin/env node
// Valide chaque exemple de specs/examples contre son schéma (ajv, draft 2020-12).
// Lancé par specs/tools/check.sh, lui-même branché sur « make check ».
//
// Chaque dossier specs/examples/<interface>/ porte un manifest.json :
//   schema : chemin du schéma, relatif au manifeste
//   cases  : [{ file, expect, rule?, now? }]
//            expect = valid | schema-invalid | rule-invalid
//   chains : (journal seulement) [{ file, expect, at?, head? }]
// Un exemple « rule-invalid » passe le schéma mais viole une règle que JSON
// Schema ne sait pas exprimer (comparaison entre deux champs, heure courante).
// Ces règles sont recopiées des specs ; la spec fait foi en cas d'écart.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Ajv2020 = require("ajv/dist/2020");

const ROOT = path.resolve(__dirname, "..");
const EXAMPLES = path.join(ROOT, "examples");

// specs/01-demande.md § 4
const MAX_TTL_S = 300;
// specs/04-journal.md § 4
const GENESIS = "0".repeat(64);

let failures = 0;
let checked = 0;
function fail(msg) {
  console.error("ECHEC " + msg);
  failures += 1;
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// --- Règles hors schéma ------------------------------------------------------

// specs/01-demande.md § 4 : fenêtre de validité puis expiration, dans cet ordre.
function requestRule(req, now) {
  const ttl = req.expires_at - req.issued_at;
  if (ttl <= 0 || ttl > MAX_TTL_S) return "VALIDITY_WINDOW_INVALID";
  if (now > req.expires_at) return "REQUEST_EXPIRED";
  return null;
}

// specs/03-detecteur.md § 4
function detectorRule(out) {
  if (out.detected_at_ms < out.received_at_ms) return "TIME_ORDER";
  if (out.score !== null && out.score >= out.threshold && out.verdict !== "BLOCK") {
    return "SCORE_VERDICT";
  }
  return null;
}

// specs/05-incident.md § 2
function incidentRule(rep) {
  const t = rep.timestamps;
  for (const k of ["paused_at_ms", "alerted_at_ms"]) {
    if (t[k] !== null && t[k] < t.detected_at_ms) return "TIME_ORDER";
  }
  return null;
}

const RULES = { request: requestRule, detector: detectorRule, incident: incidentRule };

// --- Journal : forme canonique et chaîne (specs/04-journal.md § 4 et § 5) ----

// JCS (RFC 8785) restreint au domaine du journal : pas de nombre à virgule.
function jcs(v) {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("nombre non entier interdit dans le journal");
    return String(v);
  }
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  // Tri par unités de code UTF-16 : c'est l'ordre par défaut de sort().
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
}

function entryHash(entry, prevHash) {
  const body = Object.assign({}, entry);
  delete body.hash;
  delete body.prev_hash;
  return crypto
    .createHash("sha256")
    .update(Buffer.from(jcs(body), "utf8"))
    .update(Buffer.from(prevHash, "hex"))
    .digest("hex");
}

// Renvoie { code, at, head } : code = OK ou le premier défaut rencontré.
function verifyChain(lines, validate) {
  let prev = GENESIS;
  for (let i = 0; i < lines.length; i += 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch (e) {
      return { code: "FORMAT", at: i };
    }
    if (!validate(entry)) return { code: "FORMAT", at: i };
    if (entry.seq !== i) return { code: "SEQ_MISMATCH", at: i };
    if (entry.prev_hash !== prev) return { code: "PREV_MISMATCH", at: i };
    if (entryHash(entry, prev) !== entry.hash) return { code: "HASH_MISMATCH", at: i };
    prev = entry.hash;
  }
  return { code: "OK", at: lines.length, head: prev };
}

// --- Parcours des manifestes -------------------------------------------------

function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
}

for (const name of fs.readdirSync(EXAMPLES).sort()) {
  const dir = path.join(EXAMPLES, name);
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.statSync(dir).isDirectory() || !fs.existsSync(manifestPath)) continue;

  const manifest = readJson(manifestPath);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  let validate;
  try {
    validate = ajv.compile(readJson(path.resolve(dir, manifest.schema)));
  } catch (e) {
    fail(`${name} : schéma invalide (${e.message})`);
    continue;
  }

  const listed = new Set();
  for (const c of manifest.cases || []) {
    listed.add(c.file);
    checked += 1;
    const label = `${name}/${c.file}`;
    let doc;
    try {
      doc = readJson(path.join(dir, c.file));
    } catch (e) {
      fail(`${label} : illisible (${e.message})`);
      continue;
    }
    const schemaOk = validate(doc);
    if (c.expect === "schema-invalid") {
      if (schemaOk) fail(`${label} : devait être rejeté par le schéma, il est accepté`);
      continue;
    }
    if (!schemaOk) {
      fail(`${label} : rejeté par le schéma (${ajv.errorsText(validate.errors)})`);
      continue;
    }
    const rule = RULES[name] ? RULES[name](doc, c.now) : null;
    if (c.expect === "valid" && rule) fail(`${label} : valide attendu, règle violée ${rule}`);
    if (c.expect === "rule-invalid" && rule !== c.rule) {
      fail(`${label} : règle attendue ${c.rule}, obtenue ${rule}`);
    }
  }

  // Aucun exemple orphelin : tout fichier de valid/ et invalid/ est déclaré.
  for (const sub of ["valid", "invalid"]) {
    for (const f of listJson(path.join(dir, sub))) {
      if (!listed.has(`${sub}/${f}`)) fail(`${name}/${sub}/${f} : absent du manifeste`);
    }
  }

  for (const c of manifest.chains || []) {
    checked += 1;
    const label = `${name}/${c.file}`;
    const lines = fs.readFileSync(path.join(dir, c.file), "utf8").split("\n").filter((l) => l !== "");
    const res = verifyChain(lines, validate);
    if (res.code !== c.expect) {
      fail(`${label} : attendu ${c.expect}, obtenu ${res.code} à l'entrée ${res.at}`);
    } else if (c.expect !== "OK" && res.at !== c.at) {
      fail(`${label} : défaut attendu à l'entrée ${c.at}, détecté à ${res.at}`);
    } else if (c.expect === "OK" && c.head && res.head !== c.head) {
      fail(`${label} : empreinte de tête attendue ${c.head}, obtenue ${res.head}`);
    }
  }
}

if (checked === 0) fail("aucun exemple trouvé sous specs/examples");
if (failures !== 0) {
  console.error(`specs : ${failures} contrôle(s) en échec sur ${checked}`);
  process.exit(1);
}
console.log(`specs : OK (${checked} exemples et chaînes vérifiés)`);
