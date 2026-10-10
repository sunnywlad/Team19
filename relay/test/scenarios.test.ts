// Scénarios de specs/acceptance/scenarios.md, joués contre le faux coffre.
// Exigés par la branche : 1, 5 et 8. Les scénarios 3, 4 et 7 sont joués en
// plus, pour ce qui relève de relay/.
import assert from "node:assert/strict";
import { test } from "node:test";
import { REASON } from "../src/config.ts";
import { loadSchema } from "../src/schema.ts";
import { NOMINAL, makeStack } from "./world.ts";

test("scénario 1 : la facture légitime est payée", async () => {
  const s = makeStack();
  const played = await s.play("1");
  assert.equal(played.detector.verdict, "PASS");
  assert.equal(played.enqueue?.status, "accepted");
  const id = played.detector.request_id;

  assert.deepEqual(await s.relay.tick(), { submitted: 1, rejected: 0, deferred: 0, inDoubt: 0, expired: 0 });
  await s.index();

  const decision = s.indexer.currentDecision(id);
  assert.equal(decision?.decision, 2);
  assert.equal(decision?.reason_name, "NONE");
  const paid = s.indexer.events({ name: "Paid" });
  assert.equal(paid.length, 1);
  assert.equal(paid[0]!.args.amount, (10n * s.unit).toString());
  assert.equal(paid[0]!.args.beneficiaryId, s.ids["B-001"]);

  assert.equal(s.vault.cash, 90n * s.unit);
  assert.equal(s.vault.admittedDebts(), 30n * s.unit);
  assert.equal(s.vault.placeable(), 20n * s.unit);
  assert.deepEqual(s.journal.types(id), [...NOMINAL]);
  assert.equal(s.alerts.sent.length, 0);
  s.close();
});

test("scénario 1 : la sortie du bouchon de porte d'entrée est conforme à specs/03", async () => {
  const s = makeStack();
  const validate = loadSchema("detector-output.schema.json");
  for (const id of ["1", "2", "3"]) {
    const { detector } = await s.play(id);
    assert.ok(validate(detector), `scène ${id}`);
  }
  s.close();
});

test("scénario 5 : relais en panne, rien n'est autorisé et la demande expire", async () => {
  const s = makeStack();
  s.vault.fault = "down";
  const played = await s.play("5");
  const id = played.detector.request_id;
  assert.equal(played.enqueue?.status, "accepted");

  // Le relais tourne, mais n'atteint pas le coffre.
  for (let i = 0; i < 3; i += 1) {
    const report = await s.relay.tick();
    assert.equal(report.submitted, 0);
    s.clock.advanceS(4);
  }
  assert.equal(s.alerts.sent.length, 0, "pas d'alerte avant 15 s");

  s.clock.advanceS(4); // 16 s en file
  await s.relay.tick();
  assert.deepEqual(s.alerts.sent.map((a) => [a.kind, a.request_id, a.waited_s]), [["QUEUE_STALL", id, 16]]);
  await s.relay.tick();
  assert.equal(s.alerts.sent.length, 1, "une seule alerte par demande");

  s.clock.advanceS(15); // 31 s : au-delà de la durée de vie de 30 s
  assert.equal((await s.relay.tick()).expired, 1);
  assert.equal(s.queue.byRequestId(id)[0]!.status, "EXPIRED");

  // Le relais redémarre après l'expiration : il ne soumet pas la demande.
  s.vault.fault = "none";
  assert.equal((await s.relay.tick()).submitted, 0);
  await s.index();

  assert.equal(s.vault.submissions, 0);
  assert.equal(s.indexer.decisions().length + s.indexer.events({ name: "Paid" }).length, 0, "aucune décision, aucun paiement");
  assert.equal(s.vault.cash, 100n * s.unit);
  assert.deepEqual(s.journal.types(id), [...NOMINAL.slice(0, 6), "QUEUE_EXPIRED"], "parcours nominal sans SUBMITTED");
  s.close();
});

test("scénario 5 : sans clé ni RPC, le relais échoue fermé", async () => {
  const { ClosedVault } = await import("../src/vault.ts");
  const { Relay } = await import("../src/relay.ts");
  const s = makeStack();
  const closed = new Relay({
    queue: s.queue,
    vault: new ClosedVault("configuration incomplète"),
    journal: s.journal,
    alerts: s.alerts,
    pauses: s.offchainPauses,
    policy: s.policy,
    clock: s.clock.now,
  });
  await s.play("5");
  assert.deepEqual(await closed.tick(), { submitted: 0, rejected: 0, deferred: 1, inDoubt: 0, expired: 0 });
  s.clock.advanceS(31);
  assert.equal((await closed.tick()).expired, 1);
  assert.equal(s.vault.submissions, 0);
  s.close();
});

test("scénario 8 a : un rejeu n'est soumis qu'une fois", async () => {
  const s = makeStack();
  const played = await s.play("1");
  const id = played.detector.request_id;
  await s.relay.tick();
  await s.index();
  assert.equal(s.indexer.currentDecision(id)?.decision, 2);

  // La demande signée R1 est remise en file telle quelle, deux fois.
  assert.deepEqual(await s.queue.enqueue(played.signed!.raw), { status: "duplicate", id: 1 });
  assert.deepEqual(await s.queue.enqueue(played.signed!.raw), { status: "duplicate", id: 1 });
  assert.equal((await s.relay.tick()).submitted, 0);
  await s.index();

  assert.equal(s.vault.submissions, 1, "une seule soumission");
  assert.equal(s.indexer.events({ name: "Paid" }).length, 1, "un seul paiement");
  assert.equal(s.vault.cash, 90n * s.unit);
  assert.equal(s.journal.types(id).filter((t) => t === "SUBMITTED").length, 1);
  s.close();
});

test("scénario 8 a, lecture de specs : sans déduplication, le contrat refuse le rejeu", async () => {
  const s = makeStack({ queueDedupByRequestId: false });
  const played = await s.play("1");
  const id = played.detector.request_id;
  await s.relay.tick();
  assert.equal((await s.queue.enqueue(played.signed!.raw)).status, "accepted");
  await s.relay.tick();
  await s.index();

  assert.equal(s.vault.submissions, 2);
  assert.deepEqual(s.indexer.decisions({ requestId: id }).map((d) => [d.decision, d.reason_name]), [[2, "NONE"], [0, "REQUEST_REPLAYED"]]);
  assert.equal(s.indexer.events({ name: "Paid" }).length, 1, "un seul paiement");
  assert.equal(s.vault.cash, 90n * s.unit);
  assert.deepEqual(s.journal.types(id).slice(-3), ["SUBMITTED", "ENQUEUED", "SUBMITTED"]);
  s.close();
});

test("scénario 8 a : même identifiant, contenu différent, refusé par la file", async () => {
  const s = makeStack();
  const played = await s.play("1");
  const altered = JSON.stringify({ ...played.signed!.request, ref_id: s.ids["F-002"] });
  assert.deepEqual(await s.queue.enqueue(altered), { status: "conflict" });
  await s.relay.tick();
  assert.equal(s.vault.submissions, 1);
  s.close();
});

test("scénario 8 b : la facture déjà payée est refusée sous un nouvel identifiant", async () => {
  const s = makeStack();
  await s.play("1");
  await s.relay.tick();
  const again = await s.play("8b");
  assert.equal((await s.relay.tick()).submitted, 1);
  await s.index();

  const decision = s.indexer.currentDecision(again.detector.request_id);
  assert.deepEqual([decision?.decision, decision?.reason], [0, REASON.INVOICE_ALREADY_PAID]);
  assert.equal(s.indexer.events({ name: "Paid" }).length, 1);
  assert.equal(s.vault.cash, 90n * s.unit, "inchangé depuis le scénario 1");
  assert.deepEqual(s.journal.types(again.detector.request_id), [...NOMINAL]);
  s.close();
});

test("scénario 2 : jeton invalide, rien n'entre en file", async () => {
  const s = makeStack();
  const played = await s.play("2");
  assert.deepEqual([played.detector.verdict, played.detector.reason_codes, played.detector.agent_id], ["BLOCK", ["TOKEN_INVALID"], null]);
  assert.equal(played.enqueue, null);
  assert.deepEqual(s.journal.types(), ["AUTH_REJECTED"]);
  s.close();
});

test("scénario 3 : bloquée à la porte d'entrée, le coffre n'est pas atteint", async () => {
  const s = makeStack();
  const played = await s.play("3");
  assert.equal(played.detector.verdict, "BLOCK");
  assert.equal(played.signed, null);
  await s.relay.tick();
  assert.equal(s.vault.submissions, 0);
  assert.deepEqual(s.journal.types(played.detector.request_id), ["REQUEST_RECEIVED", "DETECTION"]);
  s.close();
});

test("scénario 4 : l'attaque non détectée est refusée par le coffre, facture inconnue", async () => {
  const s = makeStack();
  const played = await s.play("4");
  assert.equal(played.detector.verdict, "PASS");
  await s.relay.tick();
  await s.index();
  const decision = s.indexer.currentDecision(played.detector.request_id);
  assert.deepEqual([decision?.decision, decision?.reason_name], [0, "INVOICE_UNKNOWN"]);
  assert.equal(s.indexer.events({ name: "Paid" }).length, 0);
  assert.equal(s.vault.cash, 100n * s.unit);
  s.close();
});

test("scénario 7 : 30 refusés, puis 20 placés", async () => {
  const s = makeStack();
  const tooMuch = await s.play("7a");
  await s.relay.tick();
  const fits = await s.play("7b");
  await s.relay.tick();
  await s.index();
  assert.equal(s.indexer.currentDecision(tooMuch.detector.request_id)?.reason_name, "EXCEEDS_PLACEABLE");
  assert.deepEqual([s.indexer.currentDecision(fits.detector.request_id)?.decision, s.vault.cash, s.vault.placeable()], [2, 80n * s.unit, 0n]);
  s.close();
});

test("point o : trois agents demandeurs distincts pour les scènes 3, 4 et 1", async () => {
  const s = makeStack();
  const agents = [];
  for (const id of ["3", "4", "1"]) agents.push((await s.play(id)).detector.agent_id);
  assert.deepEqual(agents, [s.ids["A-DEM-2"], s.ids["A-DEM-3"], s.ids["A-DEM-1"]]);
  s.close();
});
