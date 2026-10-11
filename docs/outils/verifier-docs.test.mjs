// « conforme » : interdit partout, sauf dans la forme exacte « conforme à specs/ ».
import assert from "node:assert/strict";
import { test } from "node:test";
import { formulesInterdites } from "./verifier-docs.mjs";

const conforme = (texte) => formulesInterdites(texte).filter(([formule]) => formule === "conforme").length;

test("« conforme à specs/ » est admis, en début de phrase aussi", () => {
  assert.equal(conforme("L'événement est conforme à specs/02-contrat.md:228."), 0);
  assert.equal(conforme("Conforme à specs/02-contrat.md:228."), 0);
});

test("toute autre forme de « conforme » est signalée", () => {
  for (const texte of [
    "conforme",
    "conforme DORA",
    "conforme à DORA",
    "conforme à la spec",
    "conforme aux specs/02-contrat.md",
    "conformes à specs/02-contrat.md",
    "CONFORME à specs/02-contrat.md",
    "conforme  à specs/02-contrat.md",
    "conforme\nà specs/02-contrat.md",
    "conforme à\u00a0specs/02-contrat.md",
    "conforme à specs",
    "conforme à Specs/02-contrat.md",
    "conforme à docs/specs/02-contrat.md",
  ]) {
    assert.equal(conforme(texte), 1, texte);
  }
});

test("une forme admise n'en couvre pas une autre dans le même texte", () => {
  assert.equal(conforme("Conforme à specs/02-contrat.md, donc conforme DORA."), 1);
});

test("les mots voisins ne sont pas pris pour « conforme »", () => {
  assert.equal(conforme("conformité, conformément, non-conformité"), 0);
});
