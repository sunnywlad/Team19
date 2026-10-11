// Test de fumée de la démo, en mode fake.
//
//   node demo/smoke.mjs        (make demo-smoke)
//
// 1. lance la démo ;
// 2. joue les scènes 1, 2, 3, 4 et 8 par la vraie porte ;
// 3. remet à zéro et contrôle que la file, l'index et le journal repartent
//    vides, et que les bases d'avant sont dans var/demo/archives/ ;
// 4. rejoue les mêmes scènes : le résultat doit être exactement le même ;
// 5. vérifie le chaînage du journal courant et de chaque journal archivé
//    pendant le test, avec « npm run verify-journal » ;
// 6. hygiène : aucun jeton d'agent, aucune clé, aucune signature complète dans
//    les logs ni dans la sortie des scènes ; clé en 600, var/demo/ ignoré par
//    git ; DEMO_MODE vide dans les .env.example ;
// 7. processus : un second « make demo » échoue sans rien casser ; l'arrêt
//    joué deux fois réussit ; un pid périmé ne tue rien d'étranger ;
// 8. arrête tout et contrôle que plus rien n'écoute.
//
// Toutes les étapes sont jouées même si l'une échoue, pour que l'arrêt ait
// toujours lieu. Code de sortie non nul au moindre échec, y compris un écart
// entre une scène et la spec.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { bringUpChain } from "./chain.mjs";
import { checkEnvExamples, checkVarDemo, demoTexts, knownSecrets, scanSecrets } from "./hygiene.mjs";
import { DemoError, ROOT, VAR, down, getJson, loadConfig, portFree, reset, run, status, up } from "./lib.mjs";

const SCENES = ["1", "2", "3", "4", "8"];
process.env.VAULT_MODE = "fake";
process.env.DEMO_MODE = "1";
// Comme un .env personnel posé pour offchain/ : ne doit pas déplacer la porte.
process.env.GATEWAY_PORT = "8700";
const config = loadConfig();
const steps = [];
let scenesOutput = "";
// Jetons et clé relevés à chaque étape : une remise à zéro en émet de nouveaux.
const secrets = { "jeton d'agent": new Set(), "clé de var/demo/": new Set() };
function noteSecrets() {
  for (const [what, values] of Object.entries(knownSecrets(config))) for (const value of values) secrets[what].add(value);
}

function step(name, ok, detail = "") {
  steps.push({ name, ok });
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${name}${detail ? ` : ${detail}` : ""}`);
}

async function playScenes(tag) {
  const file = join(VAR, `smoke-${tag}.json`);
  // Sortie affichée et gardée : elle est relue par le contrôle des secrets.
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "demo", "scenes.mjs"), ...SCENES, "--json", file], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], timeout: 300_000 });
    for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
      stream.on("data", (chunk) => {
        scenesOutput += chunk.toString("utf8");
        target.write(chunk);
      });
    }
    child.once("error", () => resolve(1));
    child.once("exit", (status) => resolve(status ?? 1));
  });
  let results = null;
  try {
    results = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    results = null;
  }
  const gaps = results === null ? null : results.flatMap((s) => s.checks.filter((c) => !c.ok).map((c) => `${s.id} ${c.point}`));
  const unlisted = results === null ? [] : results.flatMap((s) => s.checks.filter((c) => !c.ok && c.connu === null).map((c) => `${s.id} ${c.point}`));
  step(`scènes ${SCENES.join(", ")} (${tag})`, code === 0, gaps === null ? "aucun résultat" : gaps.length === 0 ? "aucun écart" : unlisted.length === 0 ? `${gaps.length} point(s) en écart connu, aucun écart non listé` : `écarts non listés : ${unlisted.join(" ; ")}`);
  noteSecrets();
  return results;
}

function verifyJournal(file, head) {
  const args = ["run", "--silent", "verify-journal", "--", file, ...(head ? ["--expect-head", head] : [])];
  const verified = run("npm", args, { cwd: join(ROOT, "response") });
  step(`verify-journal ${basename(file)}`, verified.status === 0, (verified.stdout || verified.stderr).trim().split("\n").at(-1));
}

async function main() {
  const journalDir = dirname(config.journalFile);
  const archivesBefore = new Set(existsSync(journalDir) ? readdirSync(journalDir) : []);
  try {
    await up(config, { chain: bringUpChain });
    step("make demo (VAULT_MODE=fake)", true, (await status(config)).map((r) => `${r.service} ${r.state}`).join(", "));
    const listening = await Promise.all(["response", "gateway", "client-ia", "relay"].map((name) => getJson(`${config.url(name)}/health`).then(() => true, () => false)));
    step("ports fixes malgré GATEWAY_PORT=8700 dans l'environnement", listening.every(Boolean) && config.ports.gateway === 8780 && (await portFree(8700)), "8790, 8780, 8770, 8787 répondent ; rien sur 8700");
  } catch (error) {
    step("make demo (VAULT_MODE=fake)", false, error instanceof Error ? error.message.split("\n")[0] : "erreur");
    return;
  }

  // Un second « make demo » échoue proprement et ne touche pas à la démo lancée.
  let second = "aucune erreur";
  try {
    await up(config, { chain: bringUpChain });
  } catch (error) {
    second = error instanceof DemoError ? error.message.split("\n")[0] : "erreur inattendue";
  }
  const stillUp = (await status(config)).every((r) => r.state === "prêt" || r.state === "ouvert");
  step("make demo une seconde fois : refusé, la démo lancée reste en place", second.startsWith("démo déjà lancée") && stillUp, second);
  noteSecrets();

  const first = await playScenes("premier passage");

  try {
    const dir = await reset(config, { chain: bringUpChain, quiet: true });
    const queue = await getJson(`${config.url("relay")}/queue`);
    const index = await getJson(`${config.url("relay")}/decisions`);
    const head = await getJson(`${config.url("response")}/journal/head`);
    const vault = await getJson(`${config.url("relay")}/vault`);
    const archived = dir !== null && ["queue.db", "index.db", "journal-outbox.db"].every((name) => existsSync(join(dir, name)));
    step("remise à zéro : bases archivées, rien d'effacé", archived, dir === null ? "aucune archive" : dir.replace(`${ROOT}/`, ""));
    step("remise à zéro : file, index et journal vides", queue.length === 0 && index.length === 0 && head.count === 0, `file ${queue.length}, décisions ${index.length}, journal ${head.count}`);
    step("remise à zéro : le faux coffre repart du monde initial", vault.cash_wei === "100000000000000000" && vault.total_held_wei === "0", `cash ${vault.cash_wei} wei`);
  } catch (error) {
    step("remise à zéro", false, error instanceof Error ? error.message.split("\n")[0] : "erreur");
  }

  const again = await playScenes("après remise à zéro");
  const identical = first !== null && again !== null && JSON.stringify(first) === JSON.stringify(again);
  step("mêmes résultats après remise à zéro", identical, identical ? `${first.length} scènes, ${first.reduce((n, s) => n + s.checks.length, 0)} points identiques` : "les deux passages diffèrent : comparer var/demo/smoke-*.json");

  verifyJournal(config.journalFile);
  for (const name of existsSync(journalDir) ? readdirSync(journalDir).sort() : []) {
    if (archivesBefore.has(name) || !name.startsWith(`${basename(config.journalFile)}.`) || !name.endsWith(".bak")) continue;
    let head;
    try {
      head = JSON.parse(readFileSync(join(journalDir, `${name}.head.json`), "utf8"));
    } catch {
      head = null;
    }
    // Un journal archivé vide n'a pas de tête à comparer.
    if (head === null || head.count > 0) verifyJournal(join(journalDir, name), head?.hash);
  }
}

function hygiene() {
  noteSecrets();
  const exact = Object.fromEntries(Object.entries(secrets).map(([what, values]) => [what, [...values]]));
  const texts = { ...demoTexts(), "sortie de make scenes": scenesOutput };
  const found = scanSecrets(texts, exact);
  step("aucun jeton, aucune clé, aucune signature complète dans les logs et la sortie des scènes", found.length === 0 && exact["jeton d'agent"].length > 0 && exact["clé de var/demo/"].length > 0, found.length === 0 ? `${Object.keys(texts).length} textes lus, ${exact["jeton d'agent"].length} jetons et ${exact["clé de var/demo/"].length} clé cherchés` : found.join(" ; "));
  const defects = checkVarDemo();
  step("var/demo/ : clé et logs en 600, dossier en 700, ignoré par git", defects.length === 0, defects.join(" ; "));
  const examples = checkEnvExamples();
  step(".env.example : DEMO_MODE vide", examples.defects.length === 0, examples.defects.length === 0 ? examples.files.join(", ") : examples.defects.join(" ; "));
}

/** Un pid périmé dans var/demo/pids.json : processus disparu, ou numéro repris par un autre. */
async function stalePids() {
  // Un processus qui n'est pas à la démo, enregistré avec une autre date de début.
  const stranger = spawn("sleep", ["60"], { stdio: "ignore" });
  const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => dead.once("exit", resolve));
  writeFileSync(join(VAR, "pids.json"), JSON.stringify({ response: { pid: stranger.pid, port: config.ports.response, started: "Thu Jan  1 00:00:00 1970" }, gateway: { pid: dead.pid, port: config.ports.gateway, started: "Thu Jan  1 00:00:00 1970" } }), "utf8");
  let outcomes = [];
  let alive = false;
  try {
    outcomes = await down(config);
    alive = stranger.exitCode === null && stranger.signalCode === null && run("ps", ["-o", "stat=", "-p", String(stranger.pid)]).stdout.trim() !== "";
  } finally {
    stranger.kill("SIGKILL");
  }
  step("pid périmé : make demo-stop ne tue rien d'étranger", alive && outcomes.every(([, outcome]) => outcome === "déjà arrêté"), outcomes.map(([name, outcome]) => `${name} ${outcome}`).join(", "));
  step("pid périmé : le registre est vidé", (await status(config)).every((r) => r.pid === null) && readFileSync(join(VAR, "pids.json"), "utf8").trim() === "{}");
}

try {
  await main();
  hygiene();
} catch (error) {
  step("déroulement", false, error instanceof Error ? error.message.split("\n")[0] : "erreur");
} finally {
  try {
    await down(config);
    const left = (await status(config)).filter((r) => r.pid !== null);
    step("make demo-stop : plus aucun service de la démo", left.length === 0, left.map((r) => r.service).join(", "));
    const free = await Promise.all(Object.entries(config.ports).filter(([name]) => name !== "anvil").map(async ([name, number]) => ((await portFree(number)) ? null : `${number} (${name})`)));
    step("make demo-stop : plus rien n'écoute sur les ports de la démo", free.every((f) => f === null), free.filter(Boolean).join(", "));
    const twice = await down(config);
    step("make demo-stop une seconde fois : réussit, rien à arrêter", twice.length === 0);
    await stalePids();
  } catch (error) {
    step("make demo-stop", false, error instanceof DemoError ? error.message : "erreur");
  }
}
const failed = steps.filter((s) => !s.ok);
console.log(`\ntest de fumée : ${steps.length - failed.length} étape(s) OK, ${failed.length} en échec`);
process.exitCode = failed.length === 0 ? 0 : 1;
