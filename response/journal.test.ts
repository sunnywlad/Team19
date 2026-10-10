import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, it } from "node:test";
import { GENESIS_HASH, Journal, canonicalize } from "./journal.ts";

let dir: string;
let path: string;

// Horloge déterministe : une seconde par entrée.
function clock(): () => Date {
  let t = Date.parse("2026-10-10T20:00:00.000Z");
  return () => new Date((t += 1000));
}

function filled(): Journal {
  const journal = new Journal(path, clock());
  journal.append({ step: "1_DEMANDE_RECUE", actor: "entree", request_id: "req-1", data: { agent: "p_a1" } });
  journal.append({ step: "2_TESTS_SECURITE", actor: "porte", request_id: "req-1", data: { score: 0.1, blocked: false } });
  journal.append({ step: "7_FILE_ENTREE", actor: "file", request_id: "req-1" });
  journal.append({ step: "1_DEMANDE_RECUE", actor: "entree", request_id: "req-2" });
  return journal;
}

// Altère la base par une connexion séparée, comme le ferait un attaquant
// ayant accès au fichier.
function tamper(sql: string): void {
  const raw = new DatabaseSync(path);
  raw.exec(sql);
  raw.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "journal-"));
  path = join(dir, "journal.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("canonicalize", () => {
  it("donne le même texte quel que soit l'ordre des clés", () => {
    assert.equal(canonicalize({ b: 1, a: { d: [1, 2], c: null } }), canonicalize({ a: { c: null, d: [1, 2] }, b: 1 }));
  });

  it("refuse un nombre non fini", () => {
    assert.throws(() => canonicalize({ x: Number.NaN }), TypeError);
  });
});

describe("Journal", () => {
  it("chaîne chaque entrée à la précédente", () => {
    const journal = filled();
    const entries = journal.entries();
    assert.equal(entries.length, 4);
    assert.equal(entries[0]?.prev_hash, GENESIS_HASH);
    assert.equal(entries[1]?.prev_hash, entries[0]?.hash);
    assert.equal(entries[3]?.prev_hash, entries[2]?.hash);
    assert.deepEqual(entries.map((e) => e.seq), [1, 2, 3, 4]);
    journal.close();
  });

  it("valide une chaîne intacte et renvoie l'empreinte de tête", () => {
    const journal = filled();
    const result = journal.verify();
    assert.equal(result.ok, true);
    assert.equal(result.count, 4);
    assert.equal(result.ok && result.head, journal.head());
    journal.close();
  });

  it("valide un journal vide", () => {
    const journal = new Journal(path);
    assert.deepEqual(journal.verify(), { ok: true, count: 0, head: GENESIS_HASH });
    journal.close();
  });

  it("filtre les entrées par demande", () => {
    const journal = filled();
    assert.equal(journal.entries("req-1").length, 3);
    assert.equal(journal.entries("req-2").length, 1);
    assert.equal(journal.entries("inconnue").length, 0);
    journal.close();
  });

  it("reprend la chaîne après réouverture du fichier", () => {
    filled().close();
    const journal = new Journal(path, clock());
    const entry = journal.append({ step: "ALERTE", actor: "reponse", request_id: "req-2" });
    assert.equal(entry.seq, 5);
    assert.equal(journal.verify().ok, true);
    journal.close();
  });

  it("refuse une étape inconnue", () => {
    const journal = new Journal(path);
    // @ts-expect-error étape hors de la liste fermée
    assert.throws(() => journal.append({ step: "PAIEMENT_LIBRE", actor: "x" }), TypeError);
    assert.equal(journal.entries().length, 0);
    journal.close();
  });

  it("détecte une entrée modifiée", () => {
    const journal = filled();
    tamper(`UPDATE journal SET data = '{"blocked":false,"score":0.9}' WHERE seq = 2`);
    const result = journal.verify();
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.seq, 2);
    journal.close();
  });

  it("détecte une entrée modifiée dont l'empreinte a été recalculée", () => {
    const journal = filled();
    // L'attaquant recalcule l'empreinte de l'entrée 2 : c'est le chaînage
    // de l'entrée 3 qui le trahit.
    tamper(`UPDATE journal SET actor = 'attaquant', hash = '${"a".repeat(64)}' WHERE seq = 2`);
    const result = journal.verify();
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.seq, 2);
    journal.close();
  });

  it("détecte une entrée supprimée au milieu", () => {
    const journal = filled();
    tamper("DELETE FROM journal WHERE seq = 2");
    const result = journal.verify();
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.seq, 3);
    journal.close();
  });

  it("détecte une entrée insérée", () => {
    const journal = filled();
    tamper("UPDATE journal SET seq = seq + 10 WHERE seq >= 3");
    const result = journal.verify();
    assert.equal(result.ok, false);
    journal.close();
  });

  it("ne détecte une troncature en fin de chaîne qu'avec l'empreinte de référence", () => {
    const journal = filled();
    const head = journal.head();
    tamper("DELETE FROM journal WHERE seq = 4");
    // Limite connue : sans référence extérieure, la chaîne restante est valide.
    assert.equal(journal.verify().ok, true);
    const result = journal.verify(head);
    assert.equal(result.ok, false);
    journal.close();
  });
});
