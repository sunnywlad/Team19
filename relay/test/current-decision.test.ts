// Décision courante d'une demande (README, « Décision courante ») : le dernier
// événement Decision qui n'est pas un refus de rejeu. Avec la forme de
// HoldPlaced.deadline et l'émission d'InvoiceRegistered par le faux coffre.
import assert from "node:assert/strict";
import { test } from "node:test";
import { argentVaultAbi } from "../src/abi.ts";
import { eventArgs } from "../src/chain-vault.ts";
import { REASON } from "../src/config.ts";
import type { IndexedDecision, IndexedEvent } from "../src/indexer.ts";
import { Indexer } from "../src/indexer.ts";
import { CLOSURES, pendingCase, summary, withApi } from "./cases.ts";
import type { Hex, SignedRequest } from "../src/types.ts";
import { makeStack } from "./world.ts";

test("décision courante : cas 1 en attente puis rejeu, la demande reste en attente", async () => {
  const s = makeStack();
  const { id, request } = await pendingCase(s);
  // Le même request_id est soumis de nouveau, deux fois : le coffre refuse.
  await s.vault.submit(request);
  await s.vault.submit(request);
  await s.index();

  assert.deepEqual(summary(s.indexer.currentDecision(id)), [1, "ABOVE_THRESHOLD"]);
  assert.equal(s.vault.totalHeld(), 30n * s.unit, "le montant est toujours bloqué");

  await withApi(s, async (get) => {
    const current = (await get(`/decisions/${id}`)).body as IndexedDecision;
    assert.deepEqual([current.decision, current.reason, current.effective_decision], [1, REASON.ABOVE_THRESHOLD, 1]);
    // Les refus de rejeu ne disparaissent pas : ils restent dans /decisions et /events.
    const all = (await get(`/decisions?request_id=${id}`)).body as IndexedDecision[];
    assert.deepEqual(all.map((d) => d.reason_name), ["ABOVE_THRESHOLD", "REQUEST_REPLAYED", "REQUEST_REPLAYED"]);
    const events = (await get("/events?name=Decision")).body as IndexedEvent[];
    assert.equal(events.filter((e) => e.request_id === id && e.args.reason === REASON.REQUEST_REPLAYED).length, 2);
    // Aucun champ ajouté : la décision courante a la forme d'une ligne de /decisions.
    assert.deepEqual(Object.keys(current).sort(), Object.keys(all[0]!).sort());
    assert.deepEqual(current, all[0]);
  });
  s.close();
});

for (const closure of CLOSURES) {
  test(`décision courante : cas 1 puis clôture ${closure.name}, la clôture remplace le cas 1`, async () => {
    const s = makeStack();
    const { id, request } = await pendingCase(s);
    await s.vault.submit(request); // rejeu pendant l'attente
    closure.close(s, id);
    await s.index();
    assert.deepEqual(summary(s.indexer.currentDecision(id)), [closure.decision, closure.name]);

    // Un rejeu après la clôture ne la remplace pas non plus.
    await s.vault.submit(request);
    await s.index();
    assert.deepEqual(summary(s.indexer.currentDecision(id)), [closure.decision, closure.name]);

    s.close();
  });
}

/** La même demande, sous le même request_id, avec une signature qui n'est pas celle du client. */
function forged(request: SignedRequest): SignedRequest {
  const flipped = request.signature[10] === "0" ? "1" : "0";
  return { ...request, signature: `${request.signature.slice(0, 10)}${flipped}${request.signature.slice(11)}` as Hex };
}

test("décision courante : cas 1 en attente puis signature invalide forgée sous le même request_id, reste en attente ; puis la clôture", async () => {
  const s = makeStack();
  const { id, request } = await pendingCase(s);
  await s.vault.submit(forged(request));
  await s.vault.submit(request); // et un rejeu, pour mêler les deux motifs ignorés
  await s.vault.submit(forged(request));
  await s.index();

  assert.deepEqual(s.indexer.decisions({ requestId: id }).map((d) => d.reason_name), ["ABOVE_THRESHOLD", "SIGNATURE_INVALID", "REQUEST_REPLAYED", "SIGNATURE_INVALID"]);
  assert.deepEqual(summary(s.indexer.currentDecision(id)), [1, "ABOVE_THRESHOLD"]);
  assert.equal(s.vault.totalHeld(), 30n * s.unit, "le montant est toujours bloqué");
  await withApi(s, async (get) => {
    const current = (await get(`/decisions/${id}`)).body as IndexedDecision;
    assert.deepEqual([current.decision, current.reason], [1, REASON.ABOVE_THRESHOLD]);
    const events = (await get("/events?name=Decision")).body as IndexedEvent[];
    assert.equal(events.filter((e) => e.request_id === id && e.args.reason === REASON.SIGNATURE_INVALID).length, 2, "les refus restent dans /events");
  });

  // Puis la clôture : elle remplace le cas 1, et une nouvelle signature forgée ne la remplace pas.
  s.vault.approve(id);
  await s.vault.submit(forged(request));
  await s.index();
  assert.deepEqual(summary(s.indexer.currentDecision(id)), [2, "APPROVED"]);
  s.close();
});

test("décision courante : seulement des signatures invalides, c'est la dernière d'entre elles", async () => {
  const s = makeStack();
  const played = await s.play("1"); // en file, jamais soumise telle quelle
  const id = played.detector.request_id;
  await s.vault.submit(forged(played.signed!.request));
  await s.vault.submit(forged(played.signed!.request));
  await s.index();
  const current = s.indexer.currentDecision(id)!;
  assert.deepEqual(summary(current), [0, "SIGNATURE_INVALID"]);
  assert.equal(current.id, s.indexer.decisions({ requestId: id }).at(-1)!.id);

  // Dès que la vraie demande est décidée, c'est elle qui compte.
  await s.relay.tick();
  await s.vault.submit(forged(played.signed!.request));
  await s.index();
  assert.deepEqual(summary(s.indexer.currentDecision(id)), [2, "NONE"]);
  s.close();
});

test("décision courante : demande sans rejeu, inchangée", async () => {
  const s = makeStack();
  const paid = await s.play("1");
  const refused = await s.play("4");
  await s.relay.tick();
  const waiting = await pendingCase(s);
  await s.index();
  assert.deepEqual(summary(s.indexer.currentDecision(paid.detector.request_id)), [2, "NONE"]);
  assert.deepEqual(summary(s.indexer.currentDecision(refused.detector.request_id)), [0, "INVOICE_UNKNOWN"]);
  assert.deepEqual(summary(s.indexer.currentDecision(waiting.id)), [1, "ABOVE_THRESHOLD"]);
  assert.equal(s.indexer.currentDecision(`0x${"7".repeat(64)}`), null);
  s.close();
});

test("décision courante : décision 2 puis rejeu, la demande reste payée", async () => {
  const s = makeStack();
  const played = await s.play("1");
  await s.relay.tick();
  await s.vault.submit(played.signed!.request);
  await s.index();
  assert.deepEqual(summary(s.indexer.currentDecision(played.detector.request_id)), [2, "NONE"]);
  s.close();
});

test("décision courante : si l'index ne connaît que des rejeux, c'est le dernier d'entre eux", async () => {
  const s = makeStack();
  const { id, request } = await pendingCase(s);
  const after = (await s.vault.blockNumber()) + 1n;
  await s.vault.submit(request);
  await s.vault.submit(request);
  s.vault.mine(1);
  // Indexeur démarré après la décision d'origine : il ne l'a jamais lue.
  const late = new Indexer({ path: ":memory:", vault: s.vault, startBlock: after, confirmations: 1 });
  await late.tick();
  const current = late.currentDecision(id)!;
  assert.deepEqual(summary(current), [0, "REQUEST_REPLAYED"]);
  assert.equal(current.id, late.decisions({ requestId: id }).at(-1)!.id);
  late.close();
  s.close();
});

test("HoldPlaced.deadline : un nombre de secondes, avec le faux coffre comme avec la chaîne", async () => {
  const s = makeStack();
  const { id } = await pendingCase(s);
  await s.index();
  const hold = s.indexer.events({ name: "HoldPlaced" })[0]!;
  assert.equal(hold.request_id, id);
  assert.equal(hold.args.deadline, Math.floor(s.clock.ms / 1000) + s.f.vault.approval_delay_s);
  assert.equal(typeof hold.args.amount, "string");

  // ChainVault : viem rend uint64 et uint256 en bigint. Seuls les uint64 deviennent des nombres.
  const decoded = eventArgs("HoldPlaced", { requestId: `0x${"AB".repeat(32)}`, refId: id, amount: 30n * s.unit, deadline: 1791662430n });
  assert.deepEqual(decoded, { requestId: `0x${"ab".repeat(32)}`, refId: id, amount: (30n * s.unit).toString(), deadline: 1791662430 });
  assert.deepEqual(eventArgs("ApprovalDelayChanged", { previous: 30n, current: 60n }), { previous: 30, current: 60 });
  assert.deepEqual(eventArgs("ThresholdChanged", { previous: 1n, current: 2n }), { previous: "1", current: "2" }, "uint256 : chaîne");
  assert.deepEqual(eventArgs("HoldPlaced", { deadline: 2n ** 63n }), { deadline: (2n ** 63n).toString() }, "hors entiers sûrs : pas de perte");
  assert.deepEqual(eventArgs("Decision", { action: 1, decision: 1, reason: 10 }), { action: 1, decision: 1, reason: 10 });
  s.close();
});

test("FakeVault émet InvoiceRegistered à l'inscription, avec les champs de l'interface", async () => {
  const s = makeStack();
  await s.index();
  const registered = s.indexer.events({ name: "InvoiceRegistered" });
  const expected = s.f.invoices.filter((i) => i.registered).map((i) => ({ invoiceId: i.invoice_id, beneficiaryId: s.ids[i.beneficiary!]!, amount: i.amount_wei! }));
  assert.deepEqual(registered.map((e) => e.args), expected);
  assert.ok(registered.every((e) => e.request_id === null));
  const abi = argentVaultAbi.find((item) => item.type === "event" && item.name === "InvoiceRegistered")!;
  assert.deepEqual(Object.keys(registered[0]!.args), abi.inputs.map((input) => input.name));
  s.close();
});
