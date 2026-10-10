// Monde de test de specs/examples/fixtures.json, monté sur un faux coffre.
import { generatePrivateKey } from "viem/accounts";
import { DEFAULT_POLICY, type Policy } from "../src/config.ts";
import { FakeVault } from "../src/fake-vault.ts";
import { MemoryJournal } from "../src/journal.ts";
import { ClientSigner, domainFor } from "../src/signer.ts";
import type { Hex } from "../src/types.ts";
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
  const vault = new FakeVault({
    clientId: f.ids["C-DEMO"]!,
    clientSigner: client.address,
    domain,
    policy,
    clock: clock.now,
    cash: BigInt(f.vault.cash_wei),
    safetyReserve: BigInt(f.vault.safety_reserve_wei),
    threshold: BigInt(f.vault.threshold_wei),
    approvalDelayS: f.vault.approval_delay_s,
  });
  for (const b of f.beneficiaries) vault.registerBeneficiary(b.beneficiary_id);
  for (const i of f.invoices) if (i.registered) vault.registerInvoice(i.invoice_id, f.ids[i.beneficiary!]!, BigInt(i.amount_wei!));
  for (const p of f.placements) vault.registerPlacement(p.placement_id, f.ids[p.beneficiary]!, BigInt(p.amount_wei));
  for (const a of f.agents) vault.registerAgent(a.agent_id, a.mandate);
  return { f, ids: f.ids, policy, clock, journal: new MemoryJournal(clock.now), client, vault, unit: BigInt(f.unit_wei) };
}

/** Dernière décision (décision, motif) émise par le faux coffre pour une demande. */
export async function lastDecision(w: World, requestId: Hex): Promise<[number, number] | null> {
  const events = await w.vault.events(0n, await w.vault.blockNumber());
  const last = events.filter((e) => e.name === "Decision" && e.args.requestId === requestId).at(-1);
  return last ? [last.args.decision as number, last.args.reason as number] : null;
}
