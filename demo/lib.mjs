// Socle de la démo : configuration, lancement et arrêt des services.
//
// Tout écoute sur 127.0.0.1. Les données locales vont dans var/demo/ (jamais
// versionné) : pid, un log par service, bases SQLite du relais, clé générée.
// Aucune dépendance npm : Node seul.
//
// Chaque service reçoit un environnement construit ici, variable par variable :
// il ne voit ni l'environnement de l'appelant ni les clés des autres rôles.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const VAR = join(ROOT, "var", "demo");
export const HOST = "127.0.0.1";
const PIDS = join(VAR, "pids.json");
const KEY_FILE = join(VAR, "client-signer.key");
const CHAIN_FILE = join(VAR, "chain.json");
const NODE_MIN = [22, 18];
const NODE_FLAGS = ["--disable-warning=ExperimentalWarning"];
// Adresse factice du faux coffre : elle n'entre que dans le domaine de signature.
const FAKE_VAULT_ADDRESS = `0x${"1".repeat(40)}`;
export const DEPLOY_SCRIPT = "script/DeployArgentVault.s.sol";

export class DemoError extends Error {}

// --- Configuration -----------------------------------------------------------

// Lit .env s'il existe : NOM=valeur, une par ligne. Aucune valeur n'est affichée.
function dotEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    if (value !== "") values[match[1]] = value;
  }
  return values;
}

// Ports de la démo : FIXES. Ni .env ni l'environnement de l'appelant ne les
// déplacent, parce que les mêmes noms servent ailleurs : offchain/ lit aussi
// GATEWAY_PORT (8700), et un .env personnel posé pour lui déplacerait la porte.
// Chaque service reçoit son port explicitement (services, plus bas).
export const PORTS = Object.freeze({
  response: 8790,
  gateway: 8780,
  "client-ia": 8770,
  relay: 8787,
  control: 8788,
  // Fixé aussi par dashboard/vite.config.ts (strictPort).
  dashboard: 5173,
  anvil: 8545,
});
const PORT_NAMES = ["JOURNAL_PORT", "GATEWAY_PORT", "CLIENT_IA_PORT", "API_PORT", "DEMO_CONTROL_PORT"];

/**
 * Variables : l'environnement de l'appelant, puis .env, puis les valeurs de
 * démo. Les ports font exception : toujours ceux de PORTS.
 */
export function loadConfig({ env = process.env, envFile = join(ROOT, ".env") } = {}) {
  const file = dotEnv(envFile);
  const get = (name) => {
    const value = env[name];
    return value !== undefined && value.trim() !== "" ? value.trim() : file[name];
  };
  const mode = get("VAULT_MODE") ?? "fake";
  if (mode !== "fake" && mode !== "chain") throw new DemoError("VAULT_MODE inconnu : attendu fake ou chain");
  const ports = PORTS;
  // Noms de variables de port posées ailleurs et laissées de côté : affichés par « make demo ».
  const ignoredPorts = PORT_NAMES.filter((name) => get(name) !== undefined);
  const url = (name) => `http://${HOST}:${ports[name]}`;
  return {
    mode,
    get,
    ports,
    ignoredPorts,
    url,
    chainId: get("CHAIN_ID") ?? "31337",
    // Mode chain : toujours l'anvil local de la démo, jamais un RPC posé ailleurs.
    rpcUrl: url("anvil"),
    gatewayDataDir: get("GATEWAY_DATA_DIR") ?? join(ROOT, "gateway", "var"),
    journalFile: get("JOURNAL_FILE") ?? join(ROOT, "response", "var", "journal.jsonl"),
    dashboard: (get("DEMO_DASHBOARD") ?? "1") !== "0",
  };
}

/** Clé du client pour le faux coffre : tirée ici, écrite en 600 sous var/demo/, jamais affichée. */
function generateClientKey() {
  mkdirSync(VAR, { recursive: true, mode: 0o700 });
  rmSync(KEY_FILE, { force: true });
  writeFileSync(KEY_FILE, `0x${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  chmodSync(KEY_FILE, 0o600);
}

function clientKey(config) {
  if (config.mode === "chain") {
    const key = config.get("CLIENT_SIGNER");
    if (key === undefined) throw new DemoError("variable d'environnement manquante : CLIENT_SIGNER");
    return key;
  }
  if (!existsSync(KEY_FILE)) throw new DemoError("clé de démo absente : lance « make demo »");
  return readFileSync(KEY_FILE, "utf8").trim();
}

function vaultAddress(config) {
  if (config.mode === "fake") return FAKE_VAULT_ADDRESS;
  const address = existsSync(CHAIN_FILE) ? JSON.parse(readFileSync(CHAIN_FILE, "utf8")).vault_address : config.get("VAULT_ADDRESS");
  if (address === undefined) throw new DemoError("adresse du coffre inconnue : VAULT_ADDRESS absente et aucun déploiement dans var/demo/");
  return address;
}

export function setChainVault(address) {
  writeFileSync(CHAIN_FILE, JSON.stringify({ vault_address: address }), "utf8");
}

const db = (name) => join(VAR, `${name}.db`);

/** Ce qu'il faut pour ouvrir la file du relais depuis une commande de démo : aucune clé. */
export function queueEnv(config) {
  return { JOURNAL_URL: config.url("response"), QUEUE_DB: db("queue"), JOURNAL_OUTBOX_DB: db("journal-outbox") };
}

/** Les services, dans l'ordre de lancement. `env` n'est évalué qu'au lancement. */
export function services(config) {
  const node = (cwd, script) => ({ cwd: join(ROOT, cwd), command: process.execPath, args: [...NODE_FLAGS, script] });
  const journal = config.url("response");
  const relayCommon = () => ({
    CHAIN_ID: config.chainId,
    VAULT_ADDRESS: vaultAddress(config),
    JOURNAL_URL: journal,
    QUEUE_DB: db("queue"),
    JOURNAL_OUTBOX_DB: db("journal-outbox"),
  });
  const list = [
    {
      name: "response",
      port: config.ports.response,
      ...node("response", "src/main.ts"),
      health: `${journal}/health`,
      env: () => ({ DEMO_MODE: "1", JOURNAL_PORT: String(config.ports.response), JOURNAL_FILE: config.journalFile, RELAY_API_URL: config.url("relay"), QUARANTINE_DIR: join(config.gatewayDataDir, "quarantine") }),
    },
    {
      name: "gateway",
      port: config.ports.gateway,
      ...node("gateway", "src/main.ts"),
      health: `${config.url("gateway")}/health`,
      env: () => ({ DEMO_MODE: "1", GATEWAY_PORT: String(config.ports.gateway), GATEWAY_DATA_DIR: config.gatewayDataDir, JOURNAL_URL: journal, CLIENT_AI_URL: `${config.url("client-ia")}/accepted` }),
    },
    {
      name: "client-ia",
      port: config.ports["client-ia"],
      ...node("relay", "src/client-ia.ts"),
      health: `${config.url("client-ia")}/health`,
      env: () => ({ ...relayCommon(), CLIENT_SIGNER: clientKey(config), CLIENT_IA_PORT: String(config.ports["client-ia"]) }),
    },
    {
      name: "relay",
      port: config.ports.relay,
      ...node("relay", "src/main.ts"),
      health: `${config.url("relay")}/health`,
      env: () => ({
        ...relayCommon(),
        VAULT_MODE: config.mode,
        INDEX_DB: db("index"),
        PAUSE_SOURCE_URL: journal,
        API_PORT: String(config.ports.relay),
        ...(config.mode === "fake"
          ? // Le faux coffre dérive de la clé l'adresse du signataire attendu.
            { DEMO_MODE: "1", DEMO_CONTROL_PORT: String(config.ports.control), CLIENT_SIGNER: clientKey(config) }
          : { RPC_URL: config.rpcUrl, ...(config.get("RELAYER") === undefined ? {} : { RELAYER: config.get("RELAYER") }) }),
      }),
    },
  ];
  if (config.dashboard) {
    list.push({
      name: "dashboard",
      port: config.ports.dashboard,
      cwd: join(ROOT, "dashboard"),
      command: process.execPath,
      args: [join("node_modules", "vite", "bin", "vite.js")],
      prepare: () => run(process.execPath, [join("tools", "gen-validators.mjs")], { cwd: join(ROOT, "dashboard") }),
      health: `${config.url("dashboard")}/`,
      // Mode LIVE. FIXTURES_API_URL pointe sur un port où rien n'écoute : son
      // défaut (8788) est le port de contrôle de la démo.
      env: () => ({ RELAY_API_URL: config.url("relay"), RESPONSE_API_URL: journal, RELAY_HAS_VAULT: "1", FIXTURES_API_URL: `http://${HOST}:8789` }),
    });
  }
  return list;
}

export const service = (config, name) => {
  const found = services(config).find((s) => s.name === name);
  if (!found) throw new DemoError(`service inconnu : ${name}`);
  return found;
};

// --- Processus ---------------------------------------------------------------

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Comme run, sans bloquer : les services lancés par ce processus restent relevés à leur arrêt. */
export function runAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, options);
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function readPids() {
  try {
    return JSON.parse(readFileSync(PIDS, "utf8"));
  } catch {
    return {};
  }
}

function writePids(pids) {
  mkdirSync(VAR, { recursive: true, mode: 0o700 });
  writeFileSync(PIDS, JSON.stringify(pids, null, 2), "utf8");
}

// Date de début du processus : distingue notre processus d'un autre qui aurait
// repris son numéro. Vide si le processus n'existe plus, ou s'il est terminé
// sans avoir été relevé par son parent (zombie) : il n'écoute alors plus rien.
function startedAt(pid) {
  const line = run("ps", ["-o", "stat=", "-o", "lstart=", "-p", String(pid)]).stdout.trim();
  const [state, ...started] = line.split(/\s+/);
  return line === "" || state.startsWith("Z") ? "" : started.join(" ");
}

/** Vrai si le pid enregistré est encore le processus que la démo a lancé. */
function isOurs(entry) {
  const now = startedAt(entry.pid);
  return now !== "" && now === entry.started;
}

export function portFree(number) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(number, HOST, () => probe.close(() => resolve(true)));
  });
}

async function healthy(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

function logTail(name, lines = 15) {
  try {
    return readFileSync(join(VAR, `${name}.log`), "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/** Lance un service en arrière-plan, attend son /health, enregistre son pid. */
export async function startService(svc, timeoutMs = 30_000) {
  if (!(await portFree(svc.port))) throw new DemoError(`${svc.name} : le port ${svc.port} est déjà pris sur ${HOST}`);
  if (svc.prepare) {
    const prepared = svc.prepare();
    if (prepared.status !== 0) throw new DemoError(`${svc.name} : préparation en échec\n${prepared.stderr.trim()}`);
  }
  mkdirSync(VAR, { recursive: true, mode: 0o700 });
  const log = openSync(join(VAR, `${svc.name}.log`), "a", 0o600);
  // Environnement minimal, puis les variables du service et rien d'autre.
  const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LANG: process.env.LANG ?? "C.UTF-8", ...svc.env() };
  // detached : le service a son propre groupe, que l'arrêt vise en entier.
  const child = spawn(svc.command, svc.args, { cwd: svc.cwd, env, detached: true, stdio: ["ignore", log, log] });
  closeSync(log);
  let exited = false;
  child.once("exit", () => (exited = true));
  child.once("error", () => (exited = true));
  child.unref();
  if (child.pid === undefined) throw new DemoError(`${svc.name} : lancement impossible`);
  const pids = readPids();
  pids[svc.name] = { pid: child.pid, port: svc.port, started: startedAt(child.pid) };
  writePids(pids);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) break;
    if (await (svc.ready ? svc.ready() : healthy(svc.health))) return child.pid;
    await sleep(150);
  }
  await stopService(svc.name);
  throw new DemoError(`${svc.name} : ${exited ? "arrêté au démarrage" : `pas de réponse sur le port ${svc.port} en ${timeoutMs / 1000} s`}\n--- fin de var/demo/${svc.name}.log ---\n${logTail(svc.name)}`);
}

/**
 * Arrête un service lancé par la démo : SIGTERM, puis SIGKILL après 5 s. Ne
 * touche qu'au pid enregistré, et seulement s'il est encore le même processus.
 */
export async function stopService(name) {
  const pids = readPids();
  const entry = pids[name];
  if (!entry) return "absent";
  let outcome = "déjà arrêté";
  if (isOurs(entry)) {
    const signal = (sig) => {
      try {
        process.kill(-entry.pid, sig);
      } catch {
        // groupe déjà disparu
      }
    };
    signal("SIGTERM");
    outcome = "arrêté";
    const deadline = Date.now() + 5000;
    while (isOurs(entry) && Date.now() < deadline) await sleep(100);
    if (isOurs(entry)) {
      signal("SIGKILL");
      outcome = "tué (SIGKILL)";
      for (let n = 0; isOurs(entry) && n < 40; n += 1) await sleep(50);
      if (isOurs(entry)) throw new DemoError(`${name} : le processus ${entry.pid} ne s'arrête pas`);
    }
  }
  delete pids[name];
  writePids(pids);
  return outcome;
}

export async function status(config) {
  const pids = readPids();
  const rows = [];
  for (const svc of services(config)) {
    const entry = pids[svc.name];
    const alive = entry !== undefined && isOurs(entry);
    const state = !alive ? "arrêté" : (await healthy(svc.health)) ? "prêt" : "lancé, ne répond pas";
    rows.push({ service: svc.name, port: svc.port, pid: alive ? entry.pid : null, state });
  }
  if (config.mode === "fake" && rows.find((r) => r.service === "relay")?.pid != null) {
    rows.push({ service: "contrôle (faux coffre)", port: config.ports.control, pid: rows.find((r) => r.service === "relay").pid, state: (await portFree(config.ports.control)) ? "fermé" : "ouvert" });
  }
  for (const [name, entry] of Object.entries(pids)) {
    if (!rows.some((r) => r.service === name) && isOurs(entry)) rows.push({ service: name, port: entry.port, pid: entry.pid, state: "lancé" });
  }
  return rows;
}

export function table(rows) {
  const head = ["service", "port", "pid", "état"];
  const body = rows.map((r) => [r.service, String(r.port), r.pid === null ? "-" : String(r.pid), r.state]);
  const width = head.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(width[i])).join("  ");
  return [line(head), line(width.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

// --- Démarrage, arrêt, remise à zéro -----------------------------------------

function preflight(config) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < NODE_MIN[0] || (major === NODE_MIN[0] && minor < NODE_MIN[1])) {
    throw new DemoError(`Node ${NODE_MIN.join(".")} ou plus récent est requis (ici : ${process.versions.node})`);
  }
  for (const dir of ["response", "gateway", "relay", ...(config.dashboard ? ["dashboard"] : [])]) {
    if (!existsSync(join(ROOT, dir, "node_modules"))) throw new DemoError(`dépendances absentes : cd ${dir} && npm ci --ignore-scripts`);
  }
  if (config.mode === "chain" && !existsSync(join(ROOT, DEPLOY_SCRIPT))) {
    // Pas de repli silencieux sur le faux coffre.
    throw new DemoError("ArgentVault absent : VAULT_MODE=chain impossible");
  }
}

export async function up(config, { chain } = {}) {
  preflight(config);
  const running = (await status(config)).filter((r) => r.pid !== null);
  if (running.length > 0) throw new DemoError(`démo déjà lancée (${running.map((r) => r.service).join(", ")}) : make demo-stop d'abord`);
  const wanted = [...services(config).map((s) => [s.name, s.port]), ...(config.mode === "fake" ? [["contrôle du faux coffre", config.ports.control]] : [["anvil", config.ports.anvil]])];
  const taken = [];
  for (const [name, number] of wanted) if (!(await portFree(number))) taken.push(`${number} (${name})`);
  if (taken.length > 0) throw new DemoError(`ports déjà pris sur ${HOST} : ${taken.join(", ")}. Libère-les, ou vérifie avec make demo-status`);

  mkdirSync(VAR, { recursive: true, mode: 0o700 });
  chmodSync(VAR, 0o700);
  archiveDatabases();
  rmSync(CHAIN_FILE, { force: true });
  if (config.mode === "fake") generateClientKey();
  try {
    if (config.mode === "chain") await chain(config);
    for (const svc of services(config)) {
      await startService(svc);
      console.log(`  ${svc.name} prêt (${svc.port})`);
    }
  } catch (error) {
    await down(config);
    throw error;
  }
}

export async function down(config) {
  const names = [...new Set([...services(config).map((s) => s.name), ...Object.keys(readPids())])].reverse();
  const outcomes = [];
  for (const name of names) {
    const outcome = await stopService(name);
    if (outcome !== "absent") outcomes.push([name, outcome]);
  }
  return outcomes;
}

function archiveStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Déplace les bases du relais (file, boîte d'envoi, index) dans une archive. Rien n'est effacé. */
export function archiveDatabases() {
  if (!existsSync(VAR)) return null;
  const files = readdirSync(VAR).filter((name) => /\.db(-wal|-shm|-journal)?$/.test(name));
  if (files.length === 0) return null;
  const base = join(VAR, "archives", archiveStamp());
  let dir = base;
  for (let n = 2; existsSync(dir); n += 1) dir = `${base}-${n}`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of files) renameSync(join(VAR, name), join(dir, name));
  return dir;
}

/**
 * Remise à zéro entre deux passages. Dans l'ordre :
 *   1. arrêt de l'IA du client et du relais, qui tiennent les bases ;
 *   2. « demo:reset » de response/ : journal et rapports ARCHIVÉS, jetons réémis ;
 *   3. arrêt de la porte et du service de réponse ; bases du relais déplacées
 *      dans var/demo/archives/<horodatage>/ ;
 *   4. relance des quatre services.
 * La porte et le service de réponse sont relancés parce qu'ils gardent en
 * mémoire un état que leur remise à zéro ne vide pas : l'historique des
 * doublons pour la première, le rang de la dernière décision lue dans l'index
 * pour le second. En mode fake, le faux coffre repart du monde initial puisque
 * le relais redémarre. Rien n'est effacé.
 */
export async function reset(config, { chain, quiet = false } = {}) {
  if (process.env.DEMO_MODE !== "1") throw new DemoError("la remise à zéro ne s'exécute qu'avec DEMO_MODE=1");
  const say = quiet ? () => {} : (text) => console.log(text);
  const all = services(config);
  const core = ["response", "gateway", "client-ia", "relay"];
  const before = await status(config);
  for (const name of ["response", "gateway"]) {
    if (before.find((r) => r.service === name)?.state !== "prêt") throw new DemoError(`${name} n'est pas lancé : make demo d'abord`);
  }
  await stopService("relay");
  await stopService("client-ia");

  const archived = run(process.execPath, [...NODE_FLAGS, "src/demo-reset.ts"], {
    cwd: join(ROOT, "response"),
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DEMO_MODE: "1", JOURNAL_URL: config.url("response"), GATEWAY_URL: config.url("gateway") },
  });
  if (archived.status !== 0) {
    // Journal non archivé : on ne déplace rien, les services reprennent tels quels.
    for (const name of ["client-ia", "relay"]) await startService(all.find((s) => s.name === name));
    throw new DemoError(`remise à zéro du journal en échec, rien n'a été déplacé\n${(archived.stderr || archived.stdout).trim()}`);
  }
  say(archived.stdout.trim());

  await stopService("gateway");
  await stopService("response");
  const dir = archiveDatabases();
  say(`bases du relais archivées : ${dir ?? "aucune"}`);
  if (config.mode === "chain") await chain(config);
  for (const name of core) await startService(all.find((s) => s.name === name));
  say(config.mode === "fake" ? "services relancés : le faux coffre repart du monde initial" : "services relancés");
  return dir;
}

// --- Lecture des services ------------------------------------------------------

export async function getJson(url, timeoutMs = 3000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${response.status} sur ${new URL(url).pathname}`);
  return response.json();
}

export async function postJson(url, body, headers = {}, timeoutMs = 10_000) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
