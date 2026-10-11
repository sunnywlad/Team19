// Démarre la porte d'entrée.
//   GATEWAY_PORT         port d'écoute sur 127.0.0.1 (défaut : 8780)
//   JOURNAL_URL          service de journal (défaut : http://127.0.0.1:8790)
//   CLIENT_AI_URL        où transmettre une demande acceptée (étape 4). Absent :
//                        la porte s'arrête après l'étape 3.
//   GATEWAY_AGENTS_FILE  agents à enrôler (défaut : specs/examples/fixtures.json)
//   GATEWAY_DATA_DIR     données locales (défaut : var/)
//   AGENT_TOKEN_TTL_SECONDS  durée de vie d'un jeton d'agent (défaut : 900)
//   DEMO_MODE            1 pour ouvrir POST /demo/reissue-tokens
//
// Au démarrage, la porte émet un jeton par agent et les écrit dans
// <GATEWAY_DATA_DIR>/agent-tokens.json, lisible par son seul propriétaire.
// Ce fichier n'est jamais versionné et les jetons expirent.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ACTIONS, DEFAULT_POLICY, SPECS_DIR, isBytes32 } from "./config.ts";
import type { Action, Hex } from "./config.ts";
import { Gateway } from "./gateway.ts";
import type { Forwarded } from "./gateway.ts";
import { HttpJournal } from "./journal.ts";
import { PauseTracker } from "./pauses.ts";
import { createGatewayServer } from "./server.ts";
import { FileQuarantine, OutputLog } from "./stores.ts";
import { TokenRegistry } from "./tokens.ts";

type AgentsFile = { ids?: Record<string, string>; agents: { label: string; agent_id: string; mandate: string[]; client_id?: string }[] };

const port = Number(process.env["GATEWAY_PORT"] || "8780");
const journalUrl = process.env["JOURNAL_URL"] || "http://127.0.0.1:8790";
const clientAiUrl = process.env["CLIENT_AI_URL"] || undefined;
const agentsFile = process.env["GATEWAY_AGENTS_FILE"] || join(SPECS_DIR, "examples", "fixtures.json");
const dataDir = process.env["GATEWAY_DATA_DIR"] || join(import.meta.dirname, "..", "var");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("GATEWAY_PORT invalide");
  process.exit(64);
}

const ttl = Number(process.env["AGENT_TOKEN_TTL_SECONDS"] || DEFAULT_POLICY.tokenTtlS);
if (!Number.isInteger(ttl) || ttl < 30 || ttl > 86_400) {
  console.error("AGENT_TOKEN_TTL_SECONDS invalide : entier de 30 à 86400 secondes");
  process.exit(64);
}

mkdirSync(dataDir, { recursive: true });
const policy = { ...DEFAULT_POLICY, tokenTtlS: ttl };
const tokens = new TokenRegistry(Date.now);

// Enrôlement : un jeton par agent du fichier, lié à son mandat.
const file = JSON.parse(readFileSync(agentsFile, "utf8")) as AgentsFile;
const defaultClient = file.ids?.["C-DEMO"];
const tokensPath = join(dataDir, "agent-tokens.json");

// Émet un jeton par agent et réécrit le fichier lu par les agents scriptés.
// Les jetons émis avant sont révoqués : un seul jeu de jetons vaut à la fois.
function issueTokens(): number {
  tokens.revokeAll();
  const issued: Record<string, { agent_id: string; token: string }> = {};
  for (const agent of file.agents) {
    const client = agent.client_id ?? defaultClient;
    const mandate = agent.mandate.filter((a): a is Action => ACTIONS.includes(a as Action));
    if (!isBytes32(agent.agent_id) || !isBytes32(client) || mandate.length !== agent.mandate.length) {
      console.error(`agent ignoré, enrôlement invalide : ${agent.label}`);
      continue;
    }
    issued[agent.label] = {
      agent_id: agent.agent_id,
      token: tokens.issue({ agent_id: agent.agent_id as Hex, client_id: client as Hex, mandate }, policy.tokenTtlS),
    };
  }
  writeFileSync(tokensPath, JSON.stringify({ expires_in_s: policy.tokenTtlS, agents: issued }, null, 2), { encoding: "utf8", mode: 0o600 });
  return Object.keys(issued).length;
}
const enrolled = issueTokens();

const forward =
  clientAiUrl === undefined
    ? undefined
    : async (request: Forwarded): Promise<void> => {
        const response = await fetch(clientAiUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error("l'IA du client a refusé la demande");
      };

const outputs = new OutputLog(join(dataDir, "detector-outputs.jsonl"));
const gateway = new Gateway({
  policy,
  clock: Date.now,
  tokens,
  pauses: new PauseTracker(tokens),
  journal: new HttpJournal(journalUrl),
  quarantine: new FileQuarantine(join(dataDir, "quarantine")),
  ...(forward === undefined ? {} : { forward }),
  onOutput: (output) => outputs.add(output),
});

const demoMode = process.env["DEMO_MODE"] === "1";
const server = createGatewayServer(gateway, outputs, policy.maxBodyBytes, demoMode ? { reissueTokens: issueTokens } : undefined);
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));

// Écoute en local uniquement.
server.listen(port, "127.0.0.1", () => {
  console.log(`porte d'entrée sur http://127.0.0.1:${port}, journal ${journalUrl}`);
  console.log(`${enrolled} agents enrôlés, jetons dans ${tokensPath} (valables ${policy.tokenTtlS} s)`);
  if (demoMode) console.log("MODE DÉMO : POST /demo/reissue-tokens réémet les jetons");
  console.log(clientAiUrl === undefined ? "étape 4 désactivée : CLIENT_AI_URL absent" : `étape 4 vers ${clientAiUrl}`);
});
