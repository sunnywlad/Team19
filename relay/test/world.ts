// Monde de test de specs/examples/fixtures.json, monté sur un faux coffre.
import { playScene, scene, type SceneResult } from "../src/agents.ts";
import { MemoryAlerts } from "../src/alerts.ts";
import { GatewayStub } from "../src/gateway-stub.ts";
import { Indexer } from "../src/indexer.ts";
import { StaticPauseSource, VaultPauseSource, anyPause } from "../src/pauses.ts";
import { Queue } from "../src/queue.ts";
import { Relay } from "../src/relay.ts";
import { generatePrivateKey } from "viem/accounts";
import { DEFAULT_POLICY, type Policy } from "../src/config.ts";
import type { FakeVault } from "../src/fake-vault.ts";
import { MemoryJournal } from "../src/journal.ts";
import { ClientSigner, domainFor } from "../src/signer.ts";
import type { Hex } from "../src/types.ts";
import { fakeVaultFromFixtures } from "../src/world.ts";
import { ManualClock, T0_MS, fixtures, type Fixtures } from "./helpers.ts";

export type World = {
  f: Fixtures;
  ids: Record<string, Hex>;
  policy: Policy;
  clock: ManualClock;
  journal: MemoryJournal;
  client: ClientSigner;
  vault: FakeVault;
  unit: bigint;
};

let counter = 0;
/** Identifiant de demande de test, unique dans le processus. */
export function freshRequestId(): Hex {
  counter += 1;
  return `0x${counter.toString(16).padStart(64, "a")}` as Hex;
}

export function makeWorld(overrides: Partial<Policy> = {}): World {
  const f = fixtures();
  const policy = { ...DEFAULT_POLICY, ...overrides };
  const clock = new ManualClock(T0_MS);
  const domain = domainFor(31337, "0x1111111111111111111111111111111111111111");
  // Clé du client tirée pour le test, jamais écrite.
  const client = new ClientSigner(generatePrivateKey(), f.ids["C-DEMO"]!, domain, policy, clock.now);
  const vault = fakeVaultFromFixtures(f, { clientSigner: client.address, domain, policy, clock: clock.now });
  return { f, ids: f.ids, policy, clock, journal: new MemoryJournal(clock.now), client, vault, unit: BigInt(f.unit_wei) };
}

/** Dernière décision (décision, motif) émise par le faux coffre pour une demande. */
export async function lastDecision(w: World, requestId: Hex): Promise<[number, number] | null> {
  const events = await w.vault.events(0n, await w.vault.blockNumber());
  const last = events.filter((e) => e.name === "Decision" && e.args.requestId === requestId).at(-1);
  return last ? [last.args.decision as number, last.args.reason as number] : null;
}

// --- Chaîne complète : porte (bouchon), client, file, relais, indexeur --------


export type Stack = World & {
  alerts: MemoryAlerts;
  offchainPauses: StaticPauseSource;
  gateway: GatewayStub;
  queue: Queue;
  relay: Relay;
  indexer: Indexer;
  play(sceneId: string): Promise<SceneResult>;
  /** Mine les confirmations puis fait tourner l'indexeur. */
  index(): Promise<number>;
  close(): void;
};

export function makeStack(overrides: Partial<Policy> = {}, paths: { queue?: string; index?: string } = {}, world?: World): Stack {
  const w = world ?? makeWorld(overrides);
  const alerts = new MemoryAlerts();
  const offchainPauses = new StaticPauseSource();
  const gateway = new GatewayStub({ journal: w.journal, clock: w.clock.now, newRequestId: freshRequestId });
  const queue = new Queue({ path: paths.queue ?? ":memory:", policy: w.policy, clock: w.clock.now, journal: w.journal, alerts });
  const relay = new Relay({
    queue,
    vault: w.vault,
    journal: w.journal,
    alerts,
    pauses: anyPause(offchainPauses, new VaultPauseSource(w.vault)),
    policy: w.policy,
    clock: w.clock.now,
  });
  const indexer = new Indexer({ path: paths.index ?? ":memory:", vault: w.vault, startBlock: 0n, confirmations: w.policy.confirmations });
  return {
    ...w,
    alerts,
    offchainPauses,
    gateway,
    queue,
    relay,
    indexer,
    play: (id) => playScene(scene(id), { ids: w.ids, gateway, client: w.client, queue, journal: w.journal, policy: w.policy }),
    async index() {
      w.vault.mine(w.policy.confirmations);
      return (await indexer.tick()).inserted;
    },
    close() {
      queue.close();
      indexer.close();
    },
  };
}

export const NOMINAL = ["REQUEST_RECEIVED", "DETECTION", "REQUEST_PARSED", "FORWARDED_TO_CLIENT_AI", "REQUEST_SIGNED", "ENQUEUED", "SUBMITTED"] as const;
