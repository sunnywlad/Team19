// Démarre le service de réponse : journal (écrivain unique), réactions
// automatiques, rapports d'incident, et lecture pour le dashboard.
//
//   JOURNAL_FILE          fichier du journal (défaut : var/journal.jsonl)
//   JOURNAL_PORT          port d'écoute sur 127.0.0.1 (défaut : 8790)
//   RELAY_API_URL         API en lecture du relais (défaut : http://127.0.0.1:8787)
//   RESPONSE_AGENTS_FILE  agents et mandats (défaut : specs/examples/fixtures.json)
//   QUARANTINE_DIR        documents gelés par la porte (défaut : ../gateway/var/quarantine)
//   RESPONSE_DATA_DIR     rapports d'incident (défaut : var/)
//   DEMO_MODE             1 pour ouvrir POST /demo/reset (archive et chaîne neuve)
//
// Aucune de ces variables n'est un secret : ce service ne tient aucune clé.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SPECS_DIR } from "./chain.ts";
import { ResponseEngine } from "./engine.ts";
import type { Alert } from "./engine.ts";
import { JournalStore } from "./journal.ts";
import { RelayWatch } from "./relay-watch.ts";
import type { ActionName } from "./report.ts";
import { createJournalServer } from "./server.ts";

const root = join(import.meta.dirname, "..");
const env = (name: string, fallback: string): string => process.env[name] || fallback;

const file = env("JOURNAL_FILE", join(root, "var", "journal.jsonl"));
const port = Number(env("JOURNAL_PORT", "8790"));
const relayUrl = env("RELAY_API_URL", "http://127.0.0.1:8787");
const agentsFile = env("RESPONSE_AGENTS_FILE", join(SPECS_DIR, "examples", "fixtures.json"));
const quarantineDir = env("QUARANTINE_DIR", join(root, "..", "gateway", "var", "quarantine"));
const dataDir = env("RESPONSE_DATA_DIR", join(root, "var"));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("JOURNAL_PORT invalide");
  process.exit(64);
}

const mandates = new Map<string, ActionName[]>();
try {
  const agents = (JSON.parse(readFileSync(agentsFile, "utf8")) as { agents: { agent_id: string; mandate: ActionName[] }[] }).agents;
  for (const agent of agents) mandates.set(agent.agent_id, agent.mandate);
} catch {
  console.error("réponse : fichier des agents illisible, mandats absents des rapports");
}

// L'alerte porte des faits bruts : identifiants, codes, motif. Ici elle
// s'affiche sur la sortie du service ; l'entrée ALERT_SENT en garde la trace.
function notify(alert: Alert): void {
  console.log(`ALERTE ${alert.kind} -> ${alert.recipients.join(", ")} : ${JSON.stringify(alert)}`);
}

const store = JournalStore.open(file);
const engine = new ResponseEngine({ store, clock: Date.now, mandates, quarantineDir, reportsDir: join(dataDir, "incidents"), notify });
const demoMode = process.env["DEMO_MODE"] === "1";
const server = createJournalServer(store, engine, Date.now, { demoMode });
const relay = new RelayWatch(relayUrl, engine);

// Décisions du contrat : chaque seconde. File : toutes les 5 secondes.
let busy = false;
const decisions = setInterval(() => {
  if (busy) return;
  busy = true;
  void relay.pollDecisions().finally(() => (busy = false));
}, 1000);
const queue = setInterval(() => void relay.pollQueue(), 5000);

function shutdown(): void {
  clearInterval(decisions);
  clearInterval(queue);
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Écoute en local uniquement : le service n'authentifie pas ses appelants.
server.listen(port, "127.0.0.1", () => {
  const head = store.head();
  console.log(`journal : ${file}`);
  console.log(`écoute sur http://127.0.0.1:${port}, ${head.count} entrées, tête ${head.hash}`);
  console.log(`relais lu sur ${relayUrl}, ${mandates.size} agents connus`);
  if (demoMode) console.log("MODE DÉMO : POST /demo/reset archive le journal et repart d'une chaîne neuve");
});
