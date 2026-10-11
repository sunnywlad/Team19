// Joue une scène : l'agent scripté envoie sa demande, le bouchon de la porte
// d'entrée rend le verdict de la fixture, le client signe, la file reçoit.
//   npm run scene -- 1        (scènes : 1, 2, 3, 4, 5, 6, 7a, 7b, 8b)
// Le relais (npm start) doit tourner sur la même QUEUE_DB pour soumettre.
import { SCENES, fixtureIds, playScene, scene } from "./agents.ts";
import { GatewayStub } from "./gateway-stub.ts";
import { MemoryJournal } from "./journal.ts";
import { Queue } from "./queue.ts";
import { chainId, clientSignerKey, dbPath, policyFromEnv, stderrAlerts, vaultAddress } from "./runtime.ts";
import { readEnv } from "./config.ts";
import { ClientSigner, domainFor } from "./signer.ts";
import { systemClock, type Hex } from "./types.ts";

const id = process.argv[2];
if (id === undefined) {
  console.error(`usage : npm run scene -- <scène>\n${SCENES.map((s) => `  ${s.id.padEnd(3)} ${s.title}`).join("\n")}`);
  process.exit(64);
}

const policy = policyFromEnv();
const ids = fixtureIds();
const journal = new MemoryJournal(systemClock); // BOUCHON
const clientId = (readEnv("CLIENT_ID") as Hex | undefined) ?? ids["C-DEMO"]!;
const client = new ClientSigner(clientSignerKey(), clientId, domainFor(chainId(), vaultAddress()), policy, systemClock);
const queue = new Queue({ path: dbPath("QUEUE_DB", "var/queue.db"), policy, clock: systemClock, journal, alerts: stderrAlerts });

const s = scene(id);
const result = await playScene(s, { ids: { ...ids, "C-DEMO": clientId }, gateway: new GatewayStub({ journal, clock: systemClock }), client, queue, journal, policy });
queue.close();

// Faits bruts seulement : ni signature, ni contenu du document.
console.log(
  JSON.stringify(
    {
      scene: s.id,
      title: s.title,
      request_id: result.detector.request_id,
      verdict: result.detector.verdict,
      reason_codes: result.detector.reason_codes,
      queue: result.enqueue?.status ?? "non mise en file",
      client_signer: client.address,
      journal: journal.types(),
    },
    null,
    2,
  ),
);
