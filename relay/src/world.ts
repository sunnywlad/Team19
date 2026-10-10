// Monde de test de specs/examples/fixtures.json, monté sur un faux coffre.
// Partagé par les tests et par la démo en VAULT_MODE=fake : une seule source.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import { SPECS_DIR, type Policy } from "./config.ts";
import { FakeVault } from "./fake-vault.ts";
import type { Domain } from "./signer.ts";
import type { Clock, Hex } from "./types.ts";

export type Fixtures = {
  unit_wei: string;
  ids: Record<string, Hex>;
  vault: { cash_wei: string; safety_reserve_wei: string; threshold_wei: string; approval_delay_s: number };
  agents: { label: string; agent_id: Hex; mandate: ("PAY_INVOICE" | "PLACE")[] }[];
  beneficiaries: { label: string; beneficiary_id: Hex }[];
  invoices: { label: string; invoice_id: Hex; beneficiary: string | null; amount_wei: string | null; registered: boolean }[];
  placements: { label: string; placement_id: Hex; beneficiary: string; amount_wei: string }[];
};

export function loadFixtures(): Fixtures {
  return JSON.parse(readFileSync(join(SPECS_DIR, "examples/fixtures.json"), "utf8")) as Fixtures;
}

export type FakeWorldDeps = { clientSigner: Address; domain: Domain; policy: Policy; clock: Clock };

/** Faux coffre dans l'état initial des fixtures : caisse, réserve, seuil, délai, registres, agents. */
export function fakeVaultFromFixtures(f: Fixtures, deps: FakeWorldDeps): FakeVault {
  const vault = new FakeVault({
    clientId: f.ids["C-DEMO"]!,
    clientSigner: deps.clientSigner,
    domain: deps.domain,
    policy: deps.policy,
    clock: deps.clock,
    cash: BigInt(f.vault.cash_wei),
    safetyReserve: BigInt(f.vault.safety_reserve_wei),
    threshold: BigInt(f.vault.threshold_wei),
    approvalDelayS: f.vault.approval_delay_s,
  });
  for (const b of f.beneficiaries) vault.registerBeneficiary(b.beneficiary_id);
  for (const i of f.invoices) if (i.registered) vault.registerInvoice(i.invoice_id, f.ids[i.beneficiary!]!, BigInt(i.amount_wei!));
  for (const p of f.placements) vault.registerPlacement(p.placement_id, f.ids[p.beneficiary]!, BigInt(p.amount_wei));
  for (const a of f.agents) vault.registerAgent(a.agent_id, a.mandate);
  return vault;
}
