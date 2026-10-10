// Lance le relais, l'indexeur et l'API en lecture seule dans un seul processus.
//   npm start        (variables : voir relay/.env.example)
import { createApi, listen, API_HOST } from "./api.ts";
import { intEnv, readEnv } from "./config.ts";
import { HttpJournal } from "./http-journal.ts";
import { Indexer } from "./indexer.ts";
import { MemoryJournal, type JournalClient } from "./journal.ts";
import { HttpPauseSource, StaticPauseSource, VaultPauseSource, anyPause } from "./pauses.ts";
import { Queue } from "./queue.ts";
import { Relay } from "./relay.ts";
import { dbPath, policyFromEnv, stderrAlerts, vaultFromEnv } from "./runtime.ts";
import { systemClock } from "./types.ts";

const policy = policyFromEnv();
const { vault, note } = vaultFromEnv();
console.error(`[relay] ${note}`);

// Journal : le service de response/ si JOURNAL_URL est posée. Il devient alors
// obligatoire : sans réponse de sa part, rien n'entre en file et rien n'est
// soumis. Sans JOURNAL_URL, bouchon en mémoire, pour un essai isolé.
const journalUrl = readEnv("JOURNAL_URL");
const journal: JournalClient = journalUrl === undefined ? new MemoryJournal(systemClock) : new HttpJournal(journalUrl);
console.error(journalUrl === undefined ? "[relay] journal : bouchon en mémoire, rien n'est conservé (JOURNAL_URL absente)" : "[relay] journal : service de journal (JOURNAL_URL)");

// Pauses hors chaîne : la liste du service de réponse si PAUSE_SOURCE_URL est
// posée. Elle devient alors obligatoire : sans réponse de sa part, rien n'est
// soumis. Sans PAUSE_SOURCE_URL, BOUCHON : liste vide, seule la chaîne compte.
const pauseUrl = readEnv("PAUSE_SOURCE_URL");
const offchainPauses = pauseUrl === undefined ? new StaticPauseSource() : new HttpPauseSource(pauseUrl);
console.error(pauseUrl === undefined ? "[relay] pauses hors chaîne : bouchon, liste vide (PAUSE_SOURCE_URL absente)" : "[relay] pauses hors chaîne : service de réponse (PAUSE_SOURCE_URL)");

const queue = new Queue({ path: dbPath("QUEUE_DB", "var/queue.db"), policy, clock: systemClock, journal, alerts: stderrAlerts });
const relay = new Relay({
  queue,
  vault,
  journal,
  alerts: stderrAlerts,
  pauses: anyPause(offchainPauses, new VaultPauseSource(vault)),
  policy,
  clock: systemClock,
});
const indexer = new Indexer({
  path: dbPath("INDEX_DB", "var/index.db"),
  vault,
  startBlock: BigInt(intEnv("START_BLOCK", 0)),
  confirmations: policy.confirmations,
});

const port = await listen(createApi({ indexer, queue, confirmations: policy.confirmations, vault }), intEnv("API_PORT", 8787));
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
