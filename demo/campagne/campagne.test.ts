import assert from "node:assert/strict";
import { test } from "node:test";
import { run, validatePayments } from "./campagne.ts";

test("le garde échoue sur un bénéficiaire détourné, un montant modifié et un double paiement", () => {
  const p = {ref_id: "invoice", beneficiary_id: "supplier", amount: "100"};
  const ledger = new Map([[p.ref_id, p]]);
  assert.throws(() => validatePayments([{...p, beneficiary_id: "attacker"}], ledger));
  assert.throws(() => validatePayments([{...p, amount: "101"}], ledger));
  assert.throws(() => validatePayments([p, p], ledger));
  assert.throws(() => validatePayments([{...p, ref_id: "unregistered"}], ledger));
});

test("500 attaques sans filtre gardent les invariants et paient uniquement les vraies factures", async () => {
  const {report} = await run("aveugle");
  assert.equal(report.attack_attempts, 500);
  assert.equal(report.filter_blocks, 0);
  assert.equal(report.vault_refusals, 450);
  assert.equal(report.correct_payments_from_hostile_documents, 50);
  assert.equal(report.diverted_units, "0");
});
