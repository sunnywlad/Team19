// Outil en ligne de commande du journal.
//   npm run journal -- verify <base> [empreinte-de-tête]
//   npm run journal -- report <base> <request_id> [--json]
import { existsSync } from "node:fs";
import { Journal } from "./journal.ts";
import { buildIncidentReport, renderMarkdown } from "./report.ts";

const USAGE = `Usage :
  verify <base> [empreinte-de-tête]   recalcule la chaîne, code de sortie 1 si elle est rompue
  report <base> <request_id> [--json] rapport d'incident d'une demande`;

function main(argv: string[]): number {
  const [command, path, ...rest] = argv;
  if (command === undefined || path === undefined || !["verify", "report"].includes(command)) {
    console.error(USAGE);
    return 2;
  }
  if (!existsSync(path)) {
    // Sans ce contrôle, SQLite créerait une base vide, déclarée valide.
    console.error(`base introuvable : ${path}`);
    return 2;
  }
  const journal = new Journal(path);
  try {
    if (command === "verify") {
      const result = journal.verify(rest[0]);
      if (result.ok) {
        console.log(`journal valide : ${result.count} entrées, tête ${result.head}`);
        return 0;
      }
      console.error(`journal ALTÉRÉ à l'entrée ${result.seq} : ${result.reason}`);
      return 1;
    }
    const requestId = rest[0];
    if (requestId === undefined) {
      console.error(USAGE);
      return 2;
    }
    const report = buildIncidentReport(journal, requestId);
    console.log(rest.includes("--json") ? JSON.stringify(report, null, 2) : renderMarkdown(report));
    return report.journal.chain_valid ? 0 : 1;
  } finally {
    journal.close();
  }
}

process.exitCode = main(process.argv.slice(2));
