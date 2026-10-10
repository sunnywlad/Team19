// Ce qui se lit à côté des décisions du contrat : les demandes arrêtées avant
// lui (journal : porte d'entrée ; relais : file), la réaction déclenchée, les
// montants portés par les événements. Rien ici ne décide : ce sont des lectures.
import type { IncidentItem, JournalEntry, QueueRow, RelayDecision, RelayEvent } from "../api/types.ts";
import { ACTION_TAKEN_LABELS, alertKindLabel, authCauseLabel, detectorCodeLabel } from "./labels.ts";
import { CLOSING_REASONS, REASON_ABOVE_THRESHOLD } from "./reasons.ts";

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

/** Montant d'un argument d'événement : chaîne décimale seulement. */
function weiArg(v: unknown): string | null {
  return typeof v === "string" && /^(0|[1-9][0-9]{0,77})$/.test(v) ? v : null;
}

/** Clé d'un événement : transaction et index de journal (specs/02 § 8), pas request_id. */
export const eventKey = (e: { tx_hash: string; log_index: number }): string => `${e.tx_hash}:${e.log_index}`;

/** Les plus récents d'abord. */
export function newestFirst<T extends { block_number: number; log_index: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.block_number - a.block_number || b.log_index - a.log_index);
}

export type DecisionAmount = { wei: string; kind: "paye" | "bloque" };

/** Montant sorti (Paid) ou bloqué (HoldPlaced) dans la transaction de cette décision. */
export function amountFor(decision: RelayDecision, events: RelayEvent[]): DecisionAmount | null {
  for (const e of events) {
    if (e.tx_hash !== decision.tx_hash || e.args.requestId !== decision.request_id) continue;
    const wei = weiArg(e.args.amount);
    if (wei === null) continue;
    if (e.name === "Paid") return { wei, kind: "paye" };
    if (e.name === "HoldPlaced") return { wei, kind: "bloque" };
  }
  return null;
}

/** Dernier rapport de chaque incident : un rapport se régénère (specs/05 § 2). */
export function latestIncidents(items: IncidentItem[]): IncidentItem[] {
  const byId = new Map<string, IncidentItem>();
  for (const item of items) {
    const known = byId.get(item.report.incident_id);
    if (!known || item.report.generated_at_ms >= known.report.generated_at_ms) byId.set(item.report.incident_id, item);
  }
  return [...byId.values()].sort((a, b) => b.report.generated_at_ms - a.report.generated_at_ms);
}

/**
 * Réaction déclenchée pour une demande, telle que le service de réponse la
 * rapporte : actions de l'incident qui la cite, alertes du journal. Liste vide :
 * rien n'a été déclenché (journal seul).
 */
export function reactionsFor(requestId: string, incidents: IncidentItem[], journal: JournalEntry[]): string[] {
  const labels: string[] = [];
  const incident = latestIncidents(incidents).find((i) => i.report.request_ids.includes(requestId));
  if (incident) for (const a of incident.report.automatic_actions) labels.push(ACTION_TAKEN_LABELS[a.action]);
  for (const entry of journal) {
    if (entry.type !== "ALERT_SENT" || entry.request_id !== requestId) continue;
    const kind = str(entry.data.kind);
    if (kind === null || (incident && kind === "SECURITY")) continue;
    labels.push(alertKindLabel(kind));
  }
  return [...new Set(labels)];
}

export type OffContractLine = {
  key: string;
  /** D'où vient la ligne : journal (service de réponse) ou file (relais). */
  origin: "journal" | "file";
  summary: string;
  detail: string | null;
  /** Texte libre du relais, à afficher comme contenu non fiable. */
  untrusted: string | null;
  requestId: string | null;
  /** Agent authentifié. null : personne n'est authentifié. */
  agentId: string | null;
  atMs: number;
};

function gatewayLine(entry: JournalEntry): OffContractLine | null {
  const base = { key: `journal:${entry.seq}`, origin: "journal" as const, untrusted: null, requestId: entry.request_id, atMs: entry.ts_ms };
  if (entry.type === "AUTH_REJECTED") {
    return { ...base, summary: "rejetée à l'entrée", detail: authCauseLabel(str(entry.data.cause) ?? ""), agentId: null };
  }
  if (entry.type === "RATE_LIMITED") {
    return { ...base, summary: "rejetée à l'entrée", detail: "limite de débit dépassée", agentId: entry.agent_id };
  }
  if (entry.type === "DETECTION" && entry.data.verdict === "BLOCK") {
    const codes = Array.isArray(entry.data.reason_codes) ? entry.data.reason_codes.filter((c) => typeof c === "string") : [];
    const score = int(entry.data.score);
    const threshold = int(entry.data.threshold);
    const scoreText = score !== null && threshold !== null ? ` · score ${score} pour un seuil de ${threshold}` : "";
    return {
      ...base,
      summary: "bloquée à la porte d'entrée",
      detail: `${codes.map((c) => `${detectorCodeLabel(c)} (${c})`).join(", ")}${scoreText}`,
      agentId: entry.agent_id,
    };
  }
  return null;
}

const QUEUE_SUMMARIES: Partial<Record<QueueRow["status"], string>> = {
  PENDING: "en file",
  SUBMITTING: "en file : soumission en cours",
  EXPIRED: "expirée en file",
  REJECTED: "écartée par le relais avant envoi",
  IN_DOUBT: "envoi incertain : jamais renvoyée automatiquement",
};

/** Demandes arrêtées avant le contrat, les plus récentes d'abord. */
export function offContractLines(journal: JournalEntry[], queue: QueueRow[], decisions: RelayDecision[]): OffContractLine[] {
  const lines: OffContractLine[] = [];
  for (const entry of journal) {
    const line = gatewayLine(entry);
    if (line) lines.push(line);
  }
  const decided = new Set(decisions.map((d) => d.request_id));
  for (const row of queue) {
    const summary =
      QUEUE_SUMMARIES[row.status] ?? (decided.has(row.request_id) ? null : "soumise : décision pas encore indexée");
    if (summary === null) continue;
    lines.push({
      key: `file:${row.id}`,
      origin: "file",
      summary,
      detail: null,
      untrusted: row.cause,
      requestId: row.request_id,
      agentId: row.agent_id,
      atMs: row.updated_at_ms,
    });
  }
  return lines.sort((a, b) => b.atMs - a.atMs);
}

/**
 * Scénario 5 : une alerte de disponibilité a été émise pour une demande que le
 * relais n'a toujours pas soumise.
 */
export function relayUnavailable(journal: JournalEntry[], queue: QueueRow[]): boolean {
  const stuck = new Set(queue.filter((r) => r.status === "PENDING" || r.status === "EXPIRED").map((r) => r.request_id));
  return journal.some((e) => e.type === "ALERT_SENT" && e.data.kind === "AVAILABILITY" && e.request_id !== null && stuck.has(e.request_id));
}

export type PendingCase = {
  requestId: string;
  refId: string;
  action: number;
  /** Montant bloqué, lu dans HoldPlaced. */
  amountWei: string | null;
  /** Bénéficiaire inscrit pour la référence, lu dans InvoiceRegistered ou PlacementRegistered. */
  beneficiaryId: string | null;
  /** Échéance, en secondes sur l'horloge des blocs. */
  deadline: number | null;
  blockNumber: number;
  blockTimestamp: number;
};

/**
 * Cas 1 ouverts : une décision 1 que n'a suivie aucune clôture (approbation,
 * refus, délai dépassé). Un rejeu de la même demande ne ferme pas le cas.
 */
export function pendingCases(decisions: RelayDecision[], events: RelayEvent[]): PendingCase[] {
  const open = new Map<string, RelayDecision>();
  const ordered = [...decisions].sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  for (const d of ordered) {
    if (d.decision === 1 && d.reason === REASON_ABOVE_THRESHOLD && d.effective_decision === 1) open.set(d.request_id, d);
    else if (CLOSING_REASONS.has(d.reason)) open.delete(d.request_id);
  }
  return [...open.values()].map((d) => {
    const hold = events.find((e) => e.name === "HoldPlaced" && e.args.requestId === d.request_id);
    const registration = events.find(
      (e) =>
        (e.name === "InvoiceRegistered" && e.args.invoiceId === d.ref_id) ||
        (e.name === "PlacementRegistered" && e.args.placementId === d.ref_id),
    );
    const rawDeadline = hold?.args.deadline;
    const deadline = typeof rawDeadline === "string" && /^[0-9]{1,15}$/.test(rawDeadline) ? Number(rawDeadline) : int(rawDeadline);
    return {
      requestId: d.request_id,
      refId: d.ref_id,
      action: d.action,
      amountWei: hold ? weiArg(hold.args.amount) : null,
      beneficiaryId: registration ? str(registration.args.beneficiaryId) : null,
      deadline,
      blockNumber: d.block_number,
      blockTimestamp: d.block_timestamp,
    };
  });
}

/** Agents en pause sur la chaîne : AgentPaused sans AgentResumed postérieur. */
export function chainPausedAgents(events: RelayEvent[]): { agentId: string; blockNumber: number; blockTimestamp: number }[] {
  const paused = new Map<string, { agentId: string; blockNumber: number; blockTimestamp: number }>();
  const ordered = [...events].sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  for (const e of ordered) {
    const agentId = str(e.args.agentId);
    if (agentId === null) continue;
    if (e.name === "AgentPaused") paused.set(agentId, { agentId, blockNumber: e.block_number, blockTimestamp: e.block_timestamp });
    if (e.name === "AgentResumed") paused.delete(agentId);
  }
  return [...paused.values()];
}

/** Coffre en pause sur la chaîne : dernier de VaultPaused et VaultResumed. */
export function chainVaultPaused(events: RelayEvent[]): boolean {
  const last = newestFirst(events.filter((e) => e.name === "VaultPaused" || e.name === "VaultResumed"))[0];
  return last?.name === "VaultPaused";
}
