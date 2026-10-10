// Le faux coffre doit rendre les décisions de specs/02 § 5 et § 6 : c'est sur
// lui que reposent les tests de scénario.
import assert from "node:assert/strict";
import { test } from "node:test";
import { REASON } from "../src/config.ts";
import type { ActionName } from "../src/config.ts";
import type { Hex, SignedRequest } from "../src/types.ts";
import { freshRequestId, lastDecision, makeWorld, type World } from "./world.ts";

async function ask(w: World, agent: string, action: ActionName, ref: string, id: Hex = freshRequestId()): Promise<SignedRequest> {
  return w.client.emit({ request_id: id, agent_id: w.ids[agent]!, action, ref_id: w.ids[ref]! });
}
async function decide(w: World, request: SignedRequest): Promise<[number, number] | null> {
  await w.vault.submit(request);
  return lastDecision(w, request.request_id);
}

test("état neuf : 100 − 40 − 40 = 20 plaçables", () => {
  const w = makeWorld();
  assert.equal(w.vault.cash, 100n * w.unit);
  assert.equal(w.vault.admittedDebts(), 40n * w.unit);
  assert.equal(w.vault.placeable(), 20n * w.unit);
});

test("décision 2 : la facture est payée, cash et dettes baissent ensemble", async () => {
  const w = makeWorld();
  assert.deepEqual(await decide(w, await ask(w, "A-DEM-1", "PAY_INVOICE", "F-001")), [2, REASON.NONE]);
  assert.equal(w.vault.cash, 90n * w.unit);
  assert.equal(w.vault.admittedDebts(), 30n * w.unit);
  assert.equal(w.vault.placeable(), 20n * w.unit);
});

test("décision 0 : facture inconnue, déjà payée, rejouée, signature invalide, expirée", async () => {
  const w = makeWorld();
  assert.deepEqual(await decide(w, await ask(w, "A-DEM-3", "PAY_INVOICE", "F-999")), [0, REASON.INVOICE_UNKNOWN]);

  const paid = await ask(w, "A-DEM-1", "PAY_INVOICE", "F-001");
  assert.deepEqual(await decide(w, paid), [2, REASON.NONE]);
  assert.deepEqual(await decide(w, paid), [0, REASON.REQUEST_REPLAYED]);
  assert.deepEqual(await decide(w, await ask(w, "A-DEM-1", "PAY_INVOICE", "F-001")), [0, REASON.INVOICE_ALREADY_PAID]);

  const forged = { ...(await ask(w, "A-DEM-1", "PAY_INVOICE", "F-002")), ref_id: w.ids["F-001"]! };
  assert.deepEqual(await decide(w, forged), [0, REASON.SIGNATURE_INVALID]);
  assert.equal(w.vault.isConsumed(forged.request_id), false, "une signature invalide ne consomme pas l'identifiant");

  const late = await ask(w, "A-DEM-1", "PAY_INVOICE", "F-002");
  w.clock.advanceS(w.policy.demoTtlS + 1);
  assert.deepEqual(await decide(w, late), [0, REASON.REQUEST_EXPIRED]);
  assert.equal(w.vault.cash, 90n * w.unit, "aucun refus ne sort de fonds");
});

test("mandat et pause de l'agent", async () => {
  const w = makeWorld();
  assert.deepEqual(await decide(w, await ask(w, "A-LECT", "PAY_INVOICE", "F-001")), [0, REASON.AGENT_NOT_AUTHORIZED]);
  assert.deepEqual(await decide(w, await ask(w, "A-DEM-1", "PLACE", "P-020")), [0, REASON.AGENT_NOT_AUTHORIZED]);
  w.vault.pauseAgent(w.ids["A-DEM-1"]!);
  assert.deepEqual(await decide(w, await ask(w, "A-DEM-1", "PAY_INVOICE", "F-001")), [0, REASON.AGENT_PAUSED]);
});

test("scénario 7 : 30 refusés, 20 placés", async () => {
  const w = makeWorld();
  assert.deepEqual(await decide(w, await ask(w, "A-TRESO", "PLACE", "P-030")), [0, REASON.EXCEEDS_PLACEABLE]);
  assert.deepEqual(await decide(w, await ask(w, "A-TRESO", "PLACE", "P-020")), [2, REASON.NONE]);
  assert.equal(w.vault.cash, 80n * w.unit);
  assert.equal(w.vault.placeable(), 0n);
});

test("scénario 6 : montant bloqué, puis approuvé, ou refusé au délai", async () => {
  const approved = makeWorld();
  const a = await ask(approved, "A-DEM-1", "PAY_INVOICE", "F-002");
  assert.deepEqual(await decide(approved, a), [1, REASON.ABOVE_THRESHOLD]);
  assert.equal(approved.vault.totalHeld(), 30n * approved.unit);
  assert.equal(approved.vault.placeable(), 20n * approved.unit, "la facture bloquée était déjà une dette admise");
  approved.vault.approve(a.request_id);
  assert.deepEqual(await lastDecision(approved, a.request_id), [2, REASON.APPROVED]);
  assert.equal(approved.vault.cash, 70n * approved.unit);

  const expired = makeWorld();
  const b = await ask(expired, "A-DEM-1", "PAY_INVOICE", "F-002");
  await decide(expired, b);
  assert.throws(() => expired.vault.expire(b.request_id), /DeadlineNotReached/);
  expired.clock.advanceS(31);
  expired.vault.approve(b.request_id); // approbation tardive : ne paie pas
  assert.deepEqual(await lastDecision(expired, b.request_id), [0, REASON.APPROVAL_TIMEOUT]);
  assert.equal(expired.vault.cash, 100n * expired.unit);
});
