// Hygiène de la démo : rien de secret dans ce qu'elle écrit ou affiche.
//
// Ce qui ne doit apparaître nulle part (logs des services, sortie de make
// scenes, var/demo/scenes-dernier.txt) : un jeton d'agent, la clé du client,
// une signature complète. Les identifiants de demande et les empreintes
// (32 octets en hexadécimal) ne sont pas des secrets et ne sont pas relevés.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, VAR, run } from "./lib.mjs";

// Signature ECDSA complète : 65 octets. Clé privée : 32 octets, relevée par sa valeur.
const SIGNATURE = /0x[0-9a-fA-F]{130}(?![0-9a-fA-F])/;
// Jeton d'agent : 32 octets en base64url, soit 43 caractères exactement (gateway/src/tokens.ts),
// avec chiffres, majuscules et minuscules : un mot ou un trait de séparation n'y ressemble pas.
const TOKEN_SHAPE = /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[G-Zg-z_-])(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/-]{20,}/i;

/**
 * Cherche des secrets dans des textes. `exact` : valeurs connues (jetons émis,
 * clé générée), cherchées telles quelles. Rend la liste des trouvailles, sans
 * jamais recopier la valeur trouvée.
 */
export function scanSecrets(texts, exact = {}) {
  const found = [];
  for (const [name, text] of Object.entries(texts)) {
    for (const [what, values] of Object.entries(exact)) {
      for (const value of values) {
        const bare = value.replace(/^0x/, "");
        if (bare.length >= 16 && text.toLowerCase().includes(bare.toLowerCase())) found.push(`${name} : ${what}`);
      }
    }
    if (SIGNATURE.test(text)) found.push(`${name} : signature complète`);
    if (BEARER.test(text)) found.push(`${name} : en-tête Bearer avec sa valeur`);
    if (TOKEN_SHAPE.test(text)) found.push(`${name} : chaîne de la forme d'un jeton d'agent`);
  }
  return [...new Set(found)];
}

/** Valeurs secrètes que la démo connaît à cet instant : jetons d'agent émis, clé du client générée. */
export function knownSecrets(config) {
  const tokens = [];
  try {
    const file = JSON.parse(readFileSync(join(config.gatewayDataDir, "agent-tokens.json"), "utf8"));
    for (const agent of Object.values(file.agents)) tokens.push(agent.token);
  } catch {
    // pas de jetons émis
  }
  const keys = keyFiles().map((path) => readFileSync(path, "utf8").trim()).filter((value) => value !== "");
  return { "jeton d'agent": tokens, "clé de var/demo/": keys };
}

export function keyFiles() {
  return existsSync(VAR) ? readdirSync(VAR).filter((name) => name.endsWith(".key")).map((name) => join(VAR, name)) : [];
}

export function demoTexts() {
  const texts = {};
  if (!existsSync(VAR)) return texts;
  for (const name of readdirSync(VAR)) {
    if (name.endsWith(".log") || name === "scenes-dernier.txt") texts[`var/demo/${name}`] = readFileSync(join(VAR, name), "utf8");
  }
  return texts;
}

const mode = (path) => (statSync(path).mode & 0o777).toString(8);

/** Droits des fichiers de var/demo/ et exclusion de git. Rend la liste des défauts. */
export function checkVarDemo() {
  const defects = [];
  if (!existsSync(VAR)) return ["var/demo/ absent"];
  if (mode(VAR) !== "700") defects.push(`var/demo/ en ${mode(VAR)}, attendu 700`);
  const keys = keyFiles();
  if (keys.length === 0) defects.push("aucun fichier de clé dans var/demo/");
  for (const path of keys) if (mode(path) !== "600") defects.push(`${path.replace(`${ROOT}/`, "")} en ${mode(path)}, attendu 600`);
  for (const name of readdirSync(VAR)) if (name.endsWith(".log") && mode(join(VAR, name)) !== "600") defects.push(`var/demo/${name} en ${mode(join(VAR, name))}, attendu 600`);
  for (const path of ["var/demo/client-signer.key", "var/demo/pids.json", "var/demo/relay.log", "var/demo/captures/x.png"]) {
    if (run("git", ["check-ignore", "-q", path], { cwd: ROOT }).status !== 0) defects.push(`${path} n'est pas ignoré par git`);
  }
  const tracked = run("git", ["ls-files", "var"], { cwd: ROOT }).stdout.trim();
  if (tracked !== "") defects.push("des fichiers de var/ sont suivis par git");
  return defects;
}

/** DEMO_MODE reste vide dans chaque .env.example : jamais « =1 » dans le dépôt. */
export function checkEnvExamples() {
  const files = run("git", ["ls-files", "*.env.example", ".env.example"], { cwd: ROOT }).stdout.split("\n").filter(Boolean);
  const defects = files.length === 0 ? ["aucun .env.example trouvé"] : [];
  for (const file of files) {
    for (const line of readFileSync(join(ROOT, file), "utf8").split("\n")) {
      if (/^\s*(export\s+)?DEMO_MODE\s*=/.test(line) && line.trim() !== "DEMO_MODE=") defects.push(`${file} : DEMO_MODE doit rester vide`);
    }
  }
  return { files, defects };
}
