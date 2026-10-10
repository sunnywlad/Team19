// Lance le relais, l'indexeur et l'API en lecture seule dans un seul processus.
//   npm start        (variables : voir relay/.env.example)
import { createApi, listen, API_HOST } from "./api.ts";
import { intEnv } from "./config.ts";
import { Indexer } from "./indexer.ts";
import { MemoryJournal } from "./journal.ts";
import { StaticPauseSource, VaultPauseSource, anyPause } from "./pauses.ts";
import { Queue } from "./queue.ts";
import { Relay } from "./relay.ts";
import { dbPath, policyFromEnv, stderrAlerts, vaultFromEnv } from "./runtime.ts";
import { systemClock } from "./types.ts";

const policy = policyFromEnv();
const { vault, note } = vaultFromEnv();
console.error(`[relay] ${note}`);

// BOUCHONS, à remplacer par feat/reponse-journal : le journal reste en mémoire
// et la liste des pauses hors chaîne est vide.
const journal = new MemoryJournal(systemClock);
console.error("[relay] journal : bouchon en mémoire, rien n'est conservé");

const queue = new Queue({ path: dbPath("QUEUE_DB", "var/queue.db"), policy, clock: systemClock, journal, alerts: stderrAlerts });
const relay = new Relay({
  queue,
  vault,
  journal,
  alerts: stderrAlerts,
  pauses: anyPause(new StaticPauseSource(), new VaultPauseSource(vault)),
  policy,
  clock: systemClock,
});
const indexer = new Indexer({
  path: dbPath("INDEX_DB", "var/index.db"),
  vault,
  startBlock: BigInt(intEnv("START_BLOCK", 0)),
  confirmations: policy.confirmations,
});

const port = await listen(createApi({ indexer, queue, confirmations: policy.confirmations }), intEnv("API_PORT", 8787));
console.error(`[relay] API en lecture seule sur http://${API_HOST}:${port}`);

// Un tour à la fois : jamais deux soumissions concurrentes de la même file.
let busy = false;
let lastError = "";
async function turn(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const report = await relay.tick();
    if (report.submitted + report.rejected + report.inDoubt + report.expired > 0) console.error(`[relay] ${JSON.stringify(report)}`);
    const { inserted } = await indexer.tick();
    if (inserted > 0) console.error(`[indexeur] ${inserted} événement(s)`);
    lastError = "";
  } catch (error) {
    // Le nom de l'erreur suffit : son message peut contenir l'URL du RPC.
    const name = error instanceof Error ? error.name : "erreur";
    if (name !== lastError) console.error(`[relay] tour en échec (${name}) : rien n'est soumis, nouvel essai au prochain tour`);
    lastError = name;
  } finally {
    busy = false;
  }
}
setInterval(() => void turn(), intEnv("POLL_INTERVAL_MS", 1000));
void turn();
