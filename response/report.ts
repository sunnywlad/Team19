// Rapport d'incident généré depuis le journal. L'outil prépare le dossier :
// il ne classe pas l'incident et ne notifie aucune autorité.
import { createHash } from "node:crypto";
import type { Journal, JournalEntry, Json, Step } from "./journal.ts";

export type IncidentReport = {
  incident_id: string;
  request_id: string;
  generated_at: string;
  origin: { agent: string | null; client: string | null };
  timeline: {
    received_at: string | null;
    detected_at: string | null;
    paused_at: string | null;
    alerted_at: string | null;
  };
  delays_ms: { detection: number | null; pause: number | null; alert: number | null };
  detection: { score: number | null; reason_codes: string[] };
  contract_decision: { code: number; reason: string | null; tx_hash: string | null } | null;
  amounts: { exposed: string | null; moved: string | null };
  automatic_actions: { step: Step; ts: string }[];
  human_decision: { decision: string | null; by: string | null; ts: string } | null;
  journal: { entries: number; head_hash: string; chain_valid: boolean };
  entries: JournalEntry[];
};

const AUTOMATIC_STEPS: Step[] = ["QUARANTAINE", "PAUSE_AGENT", "ALERTE"];

function str(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: Json | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function first(entries: JournalEntry[], step: Step): JournalEntry | undefined {
  return entries.find((e) => e.step === step);
}

function delay(from: string | null, to: string | null): number | null {
  if (from === null || to === null) return null;
  return Date.parse(to) - Date.parse(from);
}

// Le moment de détection est le premier signal de blocage : test de sécurité
// bloquant à la porte d'entrée, ou refus (code 0) du contrat.
function detectionEntry(entries: JournalEntry[]): JournalEntry | undefined {
  return entries.find(
    (e) =>
      (e.step === "2_TESTS_SECURITE" && e.data["blocked"] === true) ||
      (e.step === "9_DECISION_CONTRAT" && e.data["code"] === 0),
  );
}

export function buildIncidentReport(journal: Journal, requestId: string, now: Date = new Date()): IncidentReport {
  const entries = journal.entries(requestId);
  if (entries.length === 0) {
    throw new Error(`aucune entrée de journal pour la demande ${requestId}`);
  }
  const firstEntry = entries[0] as JournalEntry;
  const received = first(entries, "1_DEMANDE_RECUE") ?? firstEntry;
  const tests = first(entries, "2_TESTS_SECURITE");
  const decision = first(entries, "9_DECISION_CONTRAT");
  const detected = detectionEntry(entries);
  const paused = first(entries, "PAUSE_AGENT");
  const alerted = first(entries, "ALERTE");
  const human = first(entries, "QUALIFICATION_HUMAINE") ?? first(entries, "10_VALIDATION_HUMAINE");

  const origin = entries.find((e) => str(e.data["agent"]) !== null || str(e.data["client"]) !== null);
  const reasonCodes = tests?.data["reason_codes"];
  const check = journal.verify();
  const decisionCode = decision === undefined ? null : num(decision.data["code"]);

  return {
    incident_id: `INC-${createHash("sha256").update(`${requestId}|${firstEntry.ts}`).digest("hex").slice(0, 12)}`,
    request_id: requestId,
    generated_at: now.toISOString(),
    origin: {
      agent: str(origin?.data["agent"]),
      client: str(origin?.data["client"]),
    },
    timeline: {
      received_at: received.ts,
      detected_at: detected?.ts ?? null,
      paused_at: paused?.ts ?? null,
      alerted_at: alerted?.ts ?? null,
    },
    delays_ms: {
      detection: delay(received.ts, detected?.ts ?? null),
      pause: delay(detected?.ts ?? null, paused?.ts ?? null),
      alert: delay(detected?.ts ?? null, alerted?.ts ?? null),
    },
    detection: {
      score: num(tests?.data["score"]),
      reason_codes: Array.isArray(reasonCodes) ? reasonCodes.filter((c): c is string => typeof c === "string") : [],
    },
    contract_decision:
      decision === undefined || decisionCode === null
        ? null
        : { code: decisionCode, reason: str(decision.data["reason"]), tx_hash: str(decision.data["tx_hash"]) },
    amounts: {
      exposed: str(decision?.data["amount_exposed"]),
      moved: str(decision?.data["amount_moved"]),
    },
    automatic_actions: entries.filter((e) => AUTOMATIC_STEPS.includes(e.step)).map((e) => ({ step: e.step, ts: e.ts })),
    human_decision:
      human === undefined ? null : { decision: str(human.data["decision"]), by: str(human.data["by"]), ts: human.ts },
    journal: {
      entries: entries.length,
      head_hash: journal.head(),
      chain_valid: check.ok,
    },
    entries,
  };
}

const DECISION_LABELS: Record<number, string> = {
  0: "0, refusé",
  1: "1, validation humaine requise",
  2: "2, accepté",
};

function line(label: string, value: string | number | null): string {
  return `- **${label} :** ${value === null ? "non renseigné" : value}`;
}

export function renderMarkdown(report: IncidentReport): string {
  const d = report.contract_decision;
  const out: string[] = [
    `# Rapport d'incident ${report.incident_id}`,
    "",
    "Dossier prérempli depuis le journal. La classification de l'incident et une éventuelle notification restent des décisions humaines.",
    "",
    "## Identification",
    line("Demande", report.request_id),
    line("Agent d'origine (pseudonyme)", report.origin.agent),
    line("Client (pseudonyme)", report.origin.client),
    line("Rapport généré le", report.generated_at),
    "",
    "## Chronologie",
    line("Réception", report.timeline.received_at),
    line("Détection", report.timeline.detected_at),
    line("Pause de l'agent", report.timeline.paused_at),
    line("Alerte", report.timeline.alerted_at),
    line("Délai réception → détection (ms)", report.delays_ms.detection),
    line("Délai détection → pause (ms)", report.delays_ms.pause),
    line("Délai détection → alerte (ms)", report.delays_ms.alert),
    "",
    "## Détection",
    line("Score", report.detection.score),
    line("Codes raison", report.detection.reason_codes.length > 0 ? report.detection.reason_codes.join(", ") : null),
    "",
    "## Décision du contrat",
    line("Décision", d === null ? null : (DECISION_LABELS[d.code] ?? String(d.code))),
    line("Motif", d?.reason ?? null),
    line("Transaction", d?.tx_hash ?? null),
    line("Montant exposé", report.amounts.exposed),
    line("Montant sorti", report.amounts.moved),
    "",
    "## Actions automatiques",
    ...(report.automatic_actions.length > 0
      ? report.automatic_actions.map((a) => `- ${a.ts} : ${a.step}`)
      : ["- aucune"]),
    "",
    "## Décision humaine",
    ...(report.human_decision === null
      ? ["- en attente"]
      : [
          line("Décision", report.human_decision.decision),
          line("Par", report.human_decision.by),
          line("Le", report.human_decision.ts),
        ]),
    "",
    "## Intégrité du journal",
    line("Entrées de cette demande", report.journal.entries),
    line("Empreinte de tête", report.journal.head_hash),
    line("Chaîne vérifiée", report.journal.chain_valid ? "oui" : "NON, journal altéré"),
    "",
  ];
  return out.join("\n");
}
