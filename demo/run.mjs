// Orchestrateur de la démo.
//
//   node demo/run.mjs up       lance response, gateway, client-ia, relais, dashboard
//   node demo/run.mjs stop     arrête ce que « up » a lancé, et rien d'autre
//   node demo/run.mjs status   tableau service, port, état
//   node demo/run.mjs reset    remise à zéro (DEMO_MODE=1 exigé) : tout est archivé
//
// Depuis la racine : make demo, make demo-stop, make demo-status, make demo-reset.
// VAULT_MODE=fake (défaut) : faux coffre en mémoire dans le relais, aucun fonds,
// aucune chaîne. VAULT_MODE=chain : anvil et le contrat ArgentVault ; s'il
// n'existe pas, la commande s'arrête, sans repli sur le faux coffre.
import { bringUpChain } from "./chain.mjs";
import { DemoError, down, loadConfig, reset, status, table, up } from "./lib.mjs";

const USAGE = "usage : node demo/run.mjs up | stop | status | reset";

async function main(command) {
  const config = loadConfig();
  if (command === "up") {
    console.log(`démo : VAULT_MODE=${config.mode}`);
    if (config.ignoredPorts.length > 0) console.log(`ports de la démo fixes : ${config.ignoredPorts.join(", ")} de .env ou de l'environnement non pris en compte`);
    await up(config, { chain: bringUpChain });
    console.log(`\n${table(await status(config))}\n`);
    if (config.mode === "fake") console.log("COFFRE SIMULÉ : aucun fonds, aucune chaîne. Décisions rejouées par un faux coffre.");
    if (config.dashboard) console.log(`dashboard : ${config.url("dashboard")}`);
    console.log("logs : var/demo/<service>.log   scènes : make scenes   arrêt : make demo-stop");
    return 0;
  }
  if (command === "stop") {
    const outcomes = await down(config);
    console.log(outcomes.length === 0 ? "rien à arrêter : aucun service lancé par la démo" : outcomes.map(([name, outcome]) => `  ${name} : ${outcome}`).join("\n"));
    return 0;
  }
  if (command === "status") {
    const rows = await status(config);
    console.log(table(rows));
    return rows.every((r) => r.state === "prêt" || r.state === "ouvert") ? 0 : 1;
  }
  if (command === "reset") {
    await reset(config, { chain: bringUpChain });
    return 0;
  }
  console.error(USAGE);
  return 64;
}

try {
  process.exitCode = await main(process.argv[2]);
} catch (error) {
  if (!(error instanceof DemoError)) throw error;
  console.error(`démo : ${error.message}`);
  process.exitCode = 1;
}
