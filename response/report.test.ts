import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Journal } from "./journal.ts";
import { pseudonymize, pseudonymKeyFromEnv } from "./pseudonym.ts";
import { buildIncidentReport, renderMarkdown } from "./report.ts";

let dir: string;
let path: string;

function clock(): () => Date {
  let t = Date.parse("2026-10-10T20:00:00.000Z");
  return () => new Date((t += 1000));
}

// Scénario 4 : l'attaque passe la porte d'entrée, le contrat refuse.
function refusedByContract(): Journal {
  const journal = new Journal(path, clock());
  const id = "req-attaque";
  journal.append({ step: "1_DEMANDE_RECUE", actor: "entree", request_id: id, data: { agent: "p_agent", client: "p_client" } });
  journal.append({ step: "2_TESTS_SECURITE", actor: "porte", request_id: id, data: { score: 0.2, reason_codes: [], blocked: false } });
  journal.append({ step: "7_FILE_ENTREE", actor: "file", request_id: id });
  journal.append({ step: "8_SOUMISSION_CONTRAT", actor: "relais", request_id: id });
  journal.append({
    step: "9_DECISION_CONTRAT",
    actor: "relais",
    request_id: id,
    data: { code: 0, reason: "UNKNOWN_INVOICE", tx_hash: "0xabc", amount_exposed: "90", amount_moved: "0" },
  });
  journal.append({ step: "QUARANTAINE", actor: "reponse", request_id: id });
  journal.append({ step: "PAUSE_AGENT", actor: "reponse", request_id: id });
  journal.append({ step: "ALERTE", actor: "reponse", request_id: id });
  return journal;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rapport-"));
  path = join(dir, "journal.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("rapport d'incident", () => {
  it("reconstitue la chronologie et les délais d'un refus du contrat", () => {
    const journal = refusedByContract();
    const report = buildIncidentReport(journal, "req-attaque", new Date("2026-10-10T21:00:00.000Z"));

    assert.match(report.incident_id, /^INC-[0-9a-f]{12}$/);
    assert.deepEqual(report.origin, { agent: "p_agent", client: "p_client" });
    assert.deepEqual(report.contract_decision, { code: 0, reason: "UNKNOWN_INVOICE", tx_hash: "0xabc" });
    assert.deepEqual(report.amounts, { exposed: "90", moved: "0" });
    // Réception à +1 s, refus à +5 s, pause à +7 s, alerte à +8 s.
    assert.deepEqual(report.delays_ms, { detection: 4000, pause: 2000, alert: 3000 });
    assert.deepEqual(report.automatic_actions.map((a) => a.step), ["QUARANTAINE", "PAUSE_AGENT", "ALERTE"]);
    assert.equal(report.human_decision, null);
    assert.equal(report.journal.chain_valid, true);
    assert.equal(report.journal.head_hash, journal.head());
    journal.close();
  });

  it("date la détection à la porte d'entrée quand elle bloque", () => {
    const journal = new Journal(path, clock());
    journal.append({ step: "1_DEMANDE_RECUE", actor: "entree", request_id: "r" });
    journal.append({
      step: "2_TESTS_SECURITE",
      actor: "porte",
      request_id: "r",
      data: { score: 0.97, reason_codes: ["INSTRUCTION_IN_DATA"], blocked: true },
    });
    const report = buildIncidentReport(journal, "r");
    assert.equal(report.delays_ms.detection, 1000);
    assert.equal(report.detection.score, 0.97);
    assert.deepEqual(report.detection.reason_codes, ["INSTRUCTION_IN_DATA"]);
    assert.equal(report.contract_decision, null);
    journal.close();
  });

  it("ne date aucune détection pour une demande acceptée", () => {
    const journal = new Journal(path, clock());
    journal.append({ step: "1_DEMANDE_RECUE", actor: "entree", request_id: "ok" });
    journal.append({ step: "9_DECISION_CONTRAT", actor: "relais", request_id: "ok", data: { code: 2 } });
    const report = buildIncidentReport(journal, "ok");
    assert.equal(report.timeline.detected_at, null);
    assert.equal(report.delays_ms.detection, null);
    assert.equal(report.contract_decision?.code, 2);
    journal.close();
  });

  it("reprend la décision humaine", () => {
    const journal = refusedByContract();
    journal.append({
      step: "QUALIFICATION_HUMAINE",
      actor: "analyste",
      request_id: "req-attaque",
      data: { decision: "attaque confirmée", by: "p_analyste" },
    });
    const report = buildIncidentReport(journal, "req-attaque");
    assert.equal(report.human_decision?.decision, "attaque confirmée");
    assert.equal(report.human_decision?.by, "p_analyste");
    journal.close();
  });

  it("signale un journal altéré dans le rapport", () => {
    const journal = refusedByContract();
    const raw = new DatabaseSync(path);
    raw.exec(`UPDATE journal SET data = '{"code":2}' WHERE step = '9_DECISION_CONTRAT'`);
    raw.close();
    const report = buildIncidentReport(journal, "req-attaque");
    assert.equal(report.journal.chain_valid, false);
    assert.match(renderMarkdown(report), /NON, journal altéré/);
    journal.close();
  });

  it("échoue pour une demande inconnue", () => {
    const journal = refusedByContract();
    assert.throws(() => buildIncidentReport(journal, "inconnue"), /aucune entrée/);
    journal.close();
  });

  it("rend un rapport lisible", () => {
    const journal = refusedByContract();
    const text = renderMarkdown(buildIncidentReport(journal, "req-attaque"));
    assert.match(text, /# Rapport d'incident INC-/);
    assert.match(text, /0, refusé/);
    assert.match(text, /UNKNOWN_INVOICE/);
    assert.match(text, /PAUSE_AGENT/);
    assert.match(text, /Décision humaine\n- en attente/);
    journal.close();
  });
});

describe("pseudonymisation", () => {
  const key = "x".repeat(32);

  it("est stable et ne contient pas la valeur d'origine", () => {
    const a = pseudonymize("agent-lecteur-7", key);
    assert.equal(a, pseudonymize("agent-lecteur-7", key));
    assert.match(a, /^p_[0-9a-f]{24}$/);
    assert.notEqual(a, pseudonymize("agent-lecteur-8", key));
  });

  it("change avec la clé", () => {
    assert.notEqual(pseudonymize("agent", key), pseudonymize("agent", "y".repeat(32)));
  });

  it("échoue sans clé plutôt que de laisser passer la valeur en clair", () => {
    assert.throws(() => pseudonymize("agent", ""), /clé de pseudonymisation/);
    assert.throws(() => pseudonymKeyFromEnv({}), /PSEUDONYM_KEY/);
  });
});
