// Mesure des scènes : la règle de classification, et les refus d'écrire.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MesureImpossible, mesurer } from "../mesure-scenes.mjs";

const OBSERVE = {
  1: "porte : http 202 verdict PASS score 0 codes aucun · contrat : 2/NONE · Paid : 10→B-001",
  2: "porte : http 401 verdict BLOCK score null agent null codes TOKEN_INVALID · contrat : non atteint",
  3: "porte : http 403 verdict BLOCK score 100 codes INSTRUCTION_IN_DATA · contrat : non atteint · montant sorti : Paid aucun cash 100",
  4: "porte : http 202 verdict PASS score 45 codes INSTRUCTION_IN_DATA · contrat : 0/INVOICE_UNKNOWN · Paid : aucun",
  5: "porte : http 202 verdict PASS score 0 codes aucun · contrat : non atteint, aucun événement",
  "6a": "porte : http 202 verdict PASS score 0 codes aucun · contrat, 6a : 1/ABOVE_THRESHOLD, 2/APPROVED · Paid, 6a : 30→B-002",
  "6b": "porte : http 202 verdict PASS score 0 codes aucun · contrat, 6b : 1/ABOVE_THRESHOLD, 0/APPROVAL_TIMEOUT · Paid, 6b : aucun",
  "7a": "porte : http 202 verdict PASS score 0 codes aucun · contrat : 0/EXCEEDS_PLACEABLE · Paid : aucun",
  "7b": "porte : http 202 verdict PASS score 0 codes aucun · contrat, P-020 : 2/NONE · Paid, P-020 : 20→B-PLACEMENT",
  8: "8a, remise en file de R1 : acceptée · 8a, contrat : 2/NONE, 0/REQUEST_REPLAYED · 8b, porte : http 202 verdict PASS score 30 codes PAYMENT_ANOMALY · 8b, contrat : 0/INVOICE_ALREADY_PAID · Paid, total : 10→B-001",
};

function sortie({ mode = "chain", observe = {}, sans = [], fin = "résultat : aucun écart hors de la liste des écarts connus" } = {}) {
  const scenes = Object.entries({ ...OBSERVE, ...observe }).filter(([id]) => !sans.includes(id));
  return [`scènes : VAULT_MODE=${mode}, détecteur réel, journal réel`, ...scenes.map(([id, vu]) => `scène ${id} (titre) | attendu — sans objet | observé — ${vu} | OK`), "", fin].join("\n");
}
const origine = { date: "2026-10-11", commit: "abcdef0" };
const cas = (mesure, id) => mesure.cas.find((c) => c.cas === id);

test("dix scènes conformes : quatre attaques, deux passées la porte puis bloquées par le contrat, aucune sortie", () => {
  const mesure = mesurer(sortie(), origine);
  assert.deepEqual([mesure.attaques_jouees, mesure.passees_porte_bloquees_contrat, mesure.sorties_de_fonds], [4, 2, 0]);
  assert.deepEqual(mesure.cas.filter((c) => c.attaque).map((c) => c.cas), ["3", "4", "8a", "8b"]);
  assert.equal(cas(mesure, "3").passee_porte, false);
  // Le rejeu est refusé par le contrat, mais n'a pas emprunté la porte.
  assert.deepEqual([cas(mesure, "8a").passee_porte, cas(mesure, "8a").refusee_contrat, cas(mesure, "8a").passee_porte_bloquee_contrat], [false, true, false]);
});

test("8b bloquée à la porte : attaque jouée, pas « passée la porte »", () => {
  const mesure = mesurer(sortie({ observe: { 8: "8a, contrat : 2/NONE, 0/REQUEST_REPLAYED · 8b, porte : http 403 verdict BLOCK score 80 codes PAYMENT_ANOMALY · Paid, total : 10→B-001" } }), origine);
  assert.deepEqual([mesure.attaques_jouees, mesure.passees_porte_bloquees_contrat], [4, 1]);
});

test("un Paid non prévu compte comme sortie de fonds, et l'attaque n'est plus « bloquée »", () => {
  const mesure = mesurer(sortie({ observe: { 4: "porte : http 202 verdict PASS score 45 codes aucun · contrat : 2/NONE · Paid : 90→?" } }), origine);
  assert.deepEqual([mesure.passees_porte_bloquees_contrat, mesure.sorties_de_fonds], [1, 1]);
});

test("refus d'écrire : faux coffre, scène absente, écart non listé, Paid en trop non attribuable", () => {
  for (const texte of [
    sortie({ mode: "fake" }),
    sortie({ sans: ["6b"] }),
    sortie({ fin: "résultat : ÉCHEC, 1 écart(s) non listé(s), 0 écart(s) connu(s) disparu(s)" }),
    sortie({ observe: { 8: OBSERVE[8].replace("Paid, total : 10→B-001", "Paid, total : 10→B-001, 10→B-001") } }),
    sortie({ observe: { 4: "porte : http 202 verdict PASS score 45 codes aucun · contrat : 0/INVOICE_UNKNOWN" } }),
  ]) {
    assert.throws(() => mesurer(texte, origine), MesureImpossible);
  }
});
