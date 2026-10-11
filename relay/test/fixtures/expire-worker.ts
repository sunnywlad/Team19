// Processus de test : ouvre la file donnée, attend l'instant convenu, expire.
// Sort sur stdout ce qu'il a expiré et ce qu'il a journalisé.
//   node expire-worker.ts <base> <horloge ms> <départ ms>
import { MemoryAlerts } from "../../src/alerts.ts";
import { DEFAULT_POLICY } from "../../src/config.ts";
import { MemoryJournal } from "../../src/journal.ts";
import { Queue } from "../../src/queue.ts";

const [path, nowMs, startMs] = process.argv.slice(2);
const clock = (): number => Number(nowMs);
const journal = new MemoryJournal(clock);
const queue = new Queue({ path: path!, policy: DEFAULT_POLICY, clock, journal, alerts: new MemoryAlerts() });
while (Date.now() < Number(startMs)) await new Promise((resolve) => setTimeout(resolve, 1));
let expired = 0;
// Plusieurs tours, comme un service qui balaie : aucun ne doit réexpirer.
for (let turn = 0; turn < 5; turn += 1) expired += await queue.expire();
console.log(JSON.stringify({ expired, journal: journal.entries.filter((e) => e.type === "QUEUE_EXPIRED").length }));
queue.close();
