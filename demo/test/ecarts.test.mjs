// Écarts connus : un écart hors liste fait échouer, un écart listé non, un
// écart listé qui ne se produit plus fait échouer.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluate, explain, loadKnown, vanishedMessage } from "../ecarts.mjs";

const NOMINAL = ["REQUEST_RECEIVED", "DETECTION", "REQUEST_PARSED", "FORWARDED_TO_CLIENT_AI", "REQUEST_SIGNED", "ENQUEUED", "SUBMITTED"];
const LATE = ["REQUEST_RECEIVED", "DETECTION", "REQUEST_PARSED", "REQUEST_SIGNED", "ENQUEUED", "FORWARDED_TO_CLIENT_AI", "SUBMITTED"];
// Liste figée, propre aux tests : la vraie liste change quand un écart est
// corrigé, les règles de demo/ecarts.mjs restent à éprouver.
const known = loadKnown(join(dirname(fileURLToPath(import.meta.url)), "ecarts-fixture.json"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const journal = (expected, observed, tail = false) => ({ point: "journal", expected: "", observed: "", ok: same(tail ? observed.slice(-expected.length) : observed, expected), raw: { expected, observed, tail } });
const plain = (ok) => ({ point: "contrat", expected: "2/NONE", observed: ok ? "2/NONE" : "0/INVOICE_UNKNOWN", ok });

test("la liste figée des tests est bien formée : E1 et E2, chacun avec ses sept champs", () => {
  assert.deepEqual(known.map((k) => k.id), ["E1", "E2"]);
  assert.deepEqual(known.find((k) => k.id === "E2").scenes, ["5"]);
});

test("la vraie liste, demo/ecarts-connus.json, se charge : bien formée, même vide", () => {
  assert.ok(Array.isArray(loadKnown()));
});

test("un écart connu ne fait pas échouer, et reste listé comme actif", () => {
  const result = evaluate([{ id: "1", checks: [plain(true), journal([...NOMINAL, "DECISION_OBSERVED(2,0)"], [...LATE, "DECISION_OBSERVED(2,0)"])] }], known);
  assert.equal(result.code, 0);
  assert.equal(result.scenes[0].verdict, "ÉCART CONNU (E1)");
  assert.deepEqual(result.active.map((k) => k.id), ["E1"]);
  assert.deepEqual(result.unknown, []);
});

test("un écart inconnu fait échouer : autre ordre, entrée manquante, ou point hors journal", () => {
  const swapped = [...LATE];
  [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
  for (const checks of [[journal(NOMINAL, swapped)], [journal(NOMINAL, LATE.slice(0, -1))], [journal(NOMINAL, LATE), plain(false)]]) {
    const result = evaluate([{ id: "1", checks }], known);
    assert.equal(result.code, 1);
    assert.equal(result.scenes[0].verdict, "ÉCART");
    assert.equal(result.unknown.length, 1);
  }
});

test("un écart connu dans une scène que la liste ne nomme pas reste un écart", () => {
  const result = evaluate([{ id: "2", checks: [journal(NOMINAL, LATE)] }], known);
  assert.equal(result.code, 1);
  assert.equal(explain("2", journal(NOMINAL, LATE), known), null);
  // E2 ne couvre l'alerte de disponibilité qu'en scène 5.
  assert.equal(explain("1", journal(["ALERT_SENT(AVAILABILITY)"], []), known), null);
  assert.deepEqual(explain("5", journal(["ALERT_SENT(AVAILABILITY)"], []), known), ["E2"]);
});

test("un écart connu disparu fait échouer, avec la consigne de le retirer", () => {
  const result = evaluate([{ id: "1", checks: [journal(NOMINAL, NOMINAL)] }], known);
  assert.equal(result.code, 1);
  assert.equal(result.scenes[0].verdict, "OK");
  assert.deepEqual(result.vanished.map(vanishedMessage), ["écart E1 disparu : retire-le de demo/ecarts-connus.json"]);
});

test("disparu d'une scène seulement : la scène est nommée ; une scène interrompue ne compte pas", () => {
  const partial = evaluate([{ id: "1", checks: [journal(NOMINAL, LATE)] }, { id: "4", checks: [journal(NOMINAL, NOMINAL)] }], known);
  assert.equal(partial.code, 1);
  assert.deepEqual(partial.vanished.map(vanishedMessage), ["écart E1 disparu en scène 4 : retire cette scène de sa liste dans demo/ecarts-connus.json"]);
  const cut = evaluate([{ id: "1", checks: [{ point: "déroulement", expected: "", observed: "", ok: false }] }], known);
  assert.deepEqual(cut.vanished, []);
  assert.equal(cut.code, 1, "l'interruption elle-même est un écart non listé");
});

test("scène 5 : E1 et E2 ensemble sur le même journal, rien de plus", () => {
  const expected = [...NOMINAL.slice(0, -1), "ALERT_SENT(AVAILABILITY)", "QUEUE_EXPIRED"];
  assert.deepEqual(explain("5", journal(expected, [...LATE.slice(0, -1), "QUEUE_EXPIRED"]), known), ["E1", "E2"]);
  assert.equal(explain("5", journal(expected, LATE.slice(0, -1)), known), null, "QUEUE_EXPIRED manquant n'est couvert par rien");
  assert.equal(explain("5", journal(["QUEUE_EXPIRED"], []), known), null);
});

test("une scène sans rapport avec la liste n'est ni en écart ni « disparue »", () => {
  const result = evaluate([{ id: "2", checks: [plain(true)] }], known);
  assert.deepEqual([result.code, result.vanished.length, result.active.length], [0, 0, 0]);
});
