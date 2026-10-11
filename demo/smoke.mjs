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
// 6. arrête tout et contrôle que plus rien n'écoute.
//
// Toutes les étapes sont jouées même si l'une échoue, pour que l'arrêt ait
// toujours lieu. Code de sortie non nul au moindre échec, y compris un écart
// entre une scène et la spec.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { bringUpChain } from "./chain.mjs";
import { DemoError, ROOT, VAR, down, getJson, loadConfig, portFree, reset, run, runAsync, status, up } from "./lib.mjs";

const SCENES = ["1", "2", "3", "4", "8"];
process.env.VAULT_MODE = "fake";
process.env.DEMO_MODE = "1";
// Comme un .env personnel posé pour offchain/ : ne doit pas déplacer la porte.
process.env.GATEWAY_PORT = "8700";
const config = loadConfig();
const steps = [];

function step(name, ok, detail = "") {
  steps.push({ name, ok });
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${name}${detail ? ` : ${detail}` : ""}`);
}

async function playScenes(tag) {
  const file = join(VAR, `smoke-${tag}.json`);
  const code = await runAsync(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "demo", "scenes.mjs"), ...SCENES, "--json", file], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], timeout: 300_000 });
  let results = null;
  try {
    results = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    results = null;
  }
  const gaps = results === null ? null : results.flatMap((s) => s.checks.filter((c) => !c.ok).map((c) => `${s.id} ${c.point}`));
  step(`scènes ${SCENES.join(", ")} (${tag})`, code === 0, gaps === null ? "aucun résultat" : gaps.length === 0 ? "aucun écart" : `écarts avec la spec : ${gaps.join(" ; ")}`);
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

  const second = await playScenes("après remise à zéro");
  const identical = first !== null && second !== null && JSON.stringify(first) === JSON.stringify(second);
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

try {
  await main();
} catch (error) {
  step("déroulement", false, error instanceof Error ? error.message.split("\n")[0] : "erreur");
} finally {
  try {
    await down(config);
    const left = (await status(config)).filter((r) => r.pid !== null);
    step("make demo-stop : plus aucun service de la démo", left.length === 0, left.map((r) => r.service).join(", "));
  } catch (error) {
    step("make demo-stop", false, error instanceof DemoError ? error.message : "erreur");
  }
}
const failed = steps.filter((s) => !s.ok);
console.log(`\ntest de fumée : ${steps.length - failed.length} étape(s) OK, ${failed.length} en échec`);
process.exitCode = failed.length === 0 ? 0 : 1;
