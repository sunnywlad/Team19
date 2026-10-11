// Consigne une décision humaine dans le journal (PLAYBOOK, étapes 4 et 5).
//
//   npm run human -- <décision> --author <id> [--role ANALYST|OWNER|APPROVER]
//                    [--incident <id>] [--agent <id>] [--client <id>]
//
//   décisions : FALSE_POSITIVE, ATTACK_CONFIRMED, AGENT_RESUMED, TOKEN_REVOKED,
//               VAULT_PAUSED, VAULT_RESUMED
//
// AGENT_RESUMED lève la pause de l'agent désigné par --agent : c'est le seul
// moyen de la lever. Les identifiants sont opaques (0x + 64 hexadécimaux),
// jamais un nom.
import { HttpJournalClient, JournalRejectedError } from "./client.ts";

const DECISIONS = ["FALSE_POSITIVE", "ATTACK_CONFIRMED", "AGENT_RESUMED", "TOKEN_REVOKED", "VAULT_PAUSED", "VAULT_RESUMED"];
const ROLES = ["ANALYST", "OWNER", "APPROVER"];
const BYTES32 = /^0x[0-9a-f]{64}$/;
const USAGE = "usage : human <décision> --author <id> [--role ANALYST|OWNER|APPROVER] [--incident <id>] [--agent <id>] [--client <id>]";

async function main(argv: string[]): Promise<number> {
  const [decision, ...rest] = argv;
  const options: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i];
    const value = rest[i + 1];
    if (name === undefined || value === undefined || !["--author", "--role", "--incident", "--agent", "--client"].includes(name)) {
      console.error(USAGE);
      return 64;
    }
    options[name.slice(2)] = value;
  }
  const role = options["role"] ?? "ANALYST";
  const ids = [options["author"], options["incident"], options["agent"], options["client"]];
  if (decision === undefined || !DECISIONS.includes(decision) || !ROLES.includes(role) || options["author"] === undefined || ids.some((id) => id !== undefined && !BYTES32.test(id))) {
    console.error(USAGE);
    return 64;
  }
  if ((decision === "AGENT_RESUMED" || decision === "TOKEN_REVOKED") && options["agent"] === undefined) {
    console.error(`${decision} demande --agent`);
    return 64;
  }

  const journal = new HttpJournalClient(process.env["JOURNAL_URL"] || "http://127.0.0.1:8790");
  try {
    await journal.append(
      {
        type: "HUMAN_DECISION",
        component: "HUMAN",
        request_id: null,
        agent_id: options["agent"] ?? null,
        client_id: options["client"] ?? null,
        data: { incident_id: options["incident"] ?? null, decision, author_role: role, author_id: options["author"] },
      },
      // Pas de clé d'idempotence : deux décisions identiques sont deux faits distincts.
    );
  } catch (error) {
    console.error(error instanceof JournalRejectedError ? "décision refusée par le journal" : "service de journal injoignable");
    return 1;
  }
  console.log(`décision consignée : ${decision}`);
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
