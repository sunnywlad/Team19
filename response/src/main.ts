// Démarre le service de journal.
//   JOURNAL_FILE  fichier du journal (défaut : var/journal.jsonl)
//   JOURNAL_PORT  port d'écoute sur 127.0.0.1 (défaut : 8790)
import { join } from "node:path";
import { JournalStore } from "./journal.ts";
import { createJournalServer } from "./server.ts";

const file = process.env["JOURNAL_FILE"] ?? join(import.meta.dirname, "..", "var", "journal.jsonl");
const port = Number(process.env["JOURNAL_PORT"] ?? "8790");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("JOURNAL_PORT invalide");
  process.exit(64);
}

const store = JournalStore.open(file);
const server = createJournalServer(store);

function shutdown(): void {
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
});
