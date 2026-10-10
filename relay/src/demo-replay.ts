// DÉMO, scénario 8 a : remet en file, telle quelle, une demande signée déjà
// soumise. La file déduplique par request_id (config.ts, queueDedupByRequestId) ;
// cette commande ouvre la même file sans cette déduplication, pour montrer que
// c'est le contrat qui refuse le rejeu (REQUEST_REPLAYED). Elle ne signe rien
// et ne modifie pas la demande. Ne fait rien sans DEMO_MODE=1.
//   DEMO_MODE=1 npm run demo:replay -- <request_id>
import { readEnv } from "./config.ts";
import { HttpJournal } from "./http-journal.ts";
import { MemoryJournal, type JournalClient } from "./journal.ts";
import { Queue } from "./queue.ts";
import { dbPath, policyFromEnv, stderrAlerts } from "./runtime.ts";
import { systemClock, type Hex } from "./types.ts";

async function main(argv: string[]): Promise<number> {
  if (readEnv("DEMO_MODE") !== "1") {
    console.error("demo:replay ne s'exécute qu'avec DEMO_MODE=1");
    return 64;
  }
  const requestId = argv[0];
  if (requestId === undefined || !/^0x[0-9a-f]{64}$/.test(requestId)) {
    console.error("usage : demo:replay <request_id>");
    return 64;
  }
  const journalUrl = readEnv("JOURNAL_URL");
  const journal: JournalClient = journalUrl === undefined ? new MemoryJournal(systemClock) : new HttpJournal(journalUrl, { outboxPath: dbPath("JOURNAL_OUTBOX_DB", "var/journal-outbox.db") });
  const queue = new Queue({ path: dbPath("QUEUE_DB", "var/queue.db"), policy: { ...policyFromEnv(), queueDedupByRequestId: false }, clock: systemClock, journal, alerts: stderrAlerts });
  try {
    const known = queue.byRequestId(requestId as Hex)[0];
    const stored = known ? queue.payload(known.id) : null;
    if (!stored) {
      console.error("demande absente de la file : rien à rejouer");
      return 1;
    }
    const result = await queue.enqueue(stored.raw);
    console.log(JSON.stringify({ request_id: requestId, queue: result.status }));
    return result.status === "accepted" ? 0 : 1;
  } finally {
    queue.close();
  }
}

process.exitCode = await main(process.argv.slice(2));
