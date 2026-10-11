// La table ronde d'une demande : un siège par couche réelle du flux, et le
// verdict que chaque couche a rendu, lu dans ses propres traces.
//
//   Porte d'entrée  journal : AUTH_REJECTED, RATE_LIMITED, DETECTION, SCHEMA_REJECTED, REQUEST_PARSED
//   IA du client    journal : FORWARDED_TO_CLIENT_AI, REQUEST_SIGNED ; file du relais
//   Relais          file du relais (statut) ; journal : SUBMITTED, QUEUE_EXPIRED
//   Contrat         événements Decision indexés
//   Humain          événements Decision qui closent un cas 1 (approuvé, refusé, délai dépassé)
//
// Aucun siège, vote ni validateur n'est ajouté. Une couche sans trace n'est
// jamais cochée par déduction : « non disponible » si une couche plus loin a
// laissé une trace, « non atteint » sinon.
import type { JournalEntry, QueueRow, RelayDecision } from "../api/types.ts";
import { authCauseLabel, detectorCodeLabel } from "./labels.ts";
import { CLOSING_REASONS, REASON_ABOVE_THRESHOLD, readDecision } from "./reasons.ts";

export type SeatKey = "porte" | "ia" | "relais" | "contrat" | "humain";
export type Verdict = "passe" | "veto" | "attente" | "non-atteint" | "inconnu";

export const SEATS: { key: SeatKey; label: string }[] = [
  { key: "porte", label: "Porte d'entrée" },
  { key: "ia", label: "IA du client" },
  { key: "relais", label: "Relais" },
  { key: "contrat", label: "Contrat" },
  { key: "humain", label: "Humain" },
];

export const VERDICT_WORDS: Record<Verdict, string> = {
  passe: "passé",
  veto: "veto",
  attente: "en attente",
  "non-atteint": "non atteint",
  inconnu: "non disponible",
};

export type Seat = { key: SeatKey; label: string; verdict: Verdict; reason: string };

type Trace = { verdict: Exclude<Verdict, "non-atteint" | "inconnu">; reason: string } | null;

const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

function gateTrace(mine: JournalEntry[] | null): Trace {
  if (mine === null) return null;
  const auth = mine.find((e) => e.type === "AUTH_REJECTED");
  if (auth) return { verdict: "veto", reason: `rejetée à l'entrée : ${authCauseLabel(typeof auth.data.cause === "string" ? auth.data.cause : "")}` };
  if (mine.some((e) => e.type === "RATE_LIMITED")) return { verdict: "veto", reason: "limite de débit dépassée" };
  const detection = mine.find((e) => e.type === "DETECTION");
  const score = int(detection?.data.score);
  const threshold = int(detection?.data.threshold);
  const scoreText = score !== null && threshold !== null ? `score ${score} pour un seuil de ${threshold}` : null;
  if (detection && detection.data.verdict === "BLOCK") {
    const codes = Array.isArray(detection.data.reason_codes) ? detection.data.reason_codes.filter((c): c is string => typeof c === "string") : [];
    const what = codes.length === 0 ? "bloquée par le détecteur" : codes.map(detectorCodeLabel).join(", ");
    return { verdict: "veto", reason: scoreText ? `${what} · ${scoreText}` : what };
  }
  if (mine.some((e) => e.type === "SCHEMA_REJECTED")) return { verdict: "veto", reason: "rejetée par le schéma strict" };
  if (mine.some((e) => e.type === "REQUEST_PARSED" || e.type === "FORWARDED_TO_CLIENT_AI")) {
    return { verdict: "passe", reason: scoreText ? `détecteur et schéma passés · ${scoreText}` : "détecteur et schéma passés" };
  }
  if (detection && detection.data.verdict === "PASS") return { verdict: "attente", reason: "détecteur passé, schéma en cours" };
  if (mine.some((e) => e.type === "REQUEST_RECEIVED")) return { verdict: "attente", reason: "reçue, tests en cours" };
  return null;
}

function aiTrace(mine: JournalEntry[] | null, row: QueueRow | undefined): Trace {
  if (mine?.some((e) => e.type === "REQUEST_SIGNED")) return { verdict: "passe", reason: "signée par la clé du client" };
  if (row) return { verdict: "passe", reason: "signée, mise en file" };
  if (mine?.some((e) => e.type === "FORWARDED_TO_CLIENT_AI")) return { verdict: "attente", reason: "identifiants reçus, pas encore signée" };
  return null;
}

const QUEUE_TRACES: Record<QueueRow["status"], Trace> = {
  PENDING: { verdict: "attente", reason: "en file, pas encore soumise" },
  SUBMITTING: { verdict: "attente", reason: "soumission en cours" },
  SUBMITTED: { verdict: "passe", reason: "soumise au contrat" },
  EXPIRED: { verdict: "veto", reason: "expirée en file : jamais soumise" },
  REJECTED: { verdict: "veto", reason: "écartée par le relais avant envoi" },
  IN_DOUBT: { verdict: "attente", reason: "envoi incertain : jamais renvoyée automatiquement" },
};

function relayTrace(mine: JournalEntry[] | null, row: QueueRow | undefined): Trace {
  if (row) return QUEUE_TRACES[row.status];
  if (mine?.some((e) => e.type === "QUEUE_EXPIRED")) return QUEUE_TRACES.EXPIRED;
  if (mine?.some((e) => e.type === "SUBMITTED")) return QUEUE_TRACES.SUBMITTED;
  if (mine?.some((e) => e.type === "ENQUEUED")) return QUEUE_TRACES.PENDING;
  return null;
}

/** Première décision du contrat pour la demande, et la clôture humaine éventuelle. */
function decisionsOf(decisions: RelayDecision[], requestId: string): { first: RelayDecision | undefined; closing: RelayDecision | undefined } {
  const mine = decisions
    .filter((d) => d.request_id === requestId)
    .sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
  const first = mine.find((d) => !CLOSING_REASONS.has(d.reason));
  const opened = first !== undefined && readDecision(first).kind === "humain" && first.reason === REASON_ABOVE_THRESHOLD;
  const closing = opened ? mine.find((d) => CLOSING_REASONS.has(d.reason) && (d.block_number > first.block_number || (d.block_number === first.block_number && d.log_index > first.log_index))) : undefined;
  return { first, closing };
}

function contractTrace(first: RelayDecision | undefined): Trace {
  if (!first) return null;
  const read = readDecision(first);
  if (read.kind === "accepte") return { verdict: "passe", reason: read.summary };
  if (read.kind === "humain") return { verdict: "passe", reason: "renvoyée à un humain : montant au-dessus du seuil" };
  return { verdict: "veto", reason: read.downgraded ?? read.reasonLabel };
}

function humanTrace(first: RelayDecision | undefined, closing: RelayDecision | undefined): Trace | "non-requis" {
  if (!first) return null;
  if (readDecision(first).kind !== "humain") return "non-requis";
  if (!closing) return { verdict: "attente", reason: "en attente de l'approbateur, avant l'échéance" };
  const read = readDecision(closing);
  if (read.kind === "accepte") return { verdict: "passe", reason: "approuvée par l'approbateur, puis payée" };
  if (closing.reason === 11) return { verdict: "veto", reason: "délai dépassé sans réponse : refus" };
  return { verdict: "veto", reason: read.downgraded ?? read.reasonLabel };
}

export type TableInput = {
  requestId: string;
  decisions: RelayDecision[];
  queue: QueueRow[];
  /** Journal du même monde que le relais, ou null s'il ne se rapporte pas aux mêmes demandes. */
  journal: JournalEntry[] | null;
};

export function seatsFor({ requestId, decisions, queue, journal }: TableInput): Seat[] {
  const mine = journal === null ? null : journal.filter((e) => e.request_id === requestId);
  const row = queue.find((r) => r.request_id === requestId);
  const { first, closing } = decisionsOf(decisions, requestId);
  const human = humanTrace(first, closing);
  const traces: (Trace | "non-requis")[] = [gateTrace(mine), aiTrace(mine, row), relayTrace(mine, row), contractTrace(first), human];

  const seats: Seat[] = [];
  let stopped: string | null = null;
  SEATS.forEach(({ key, label }, index) => {
    const trace = traces[index] ?? null;
    if (stopped !== null) {
      seats.push({ key, label, verdict: "non-atteint", reason: `arrêtée avant : ${stopped}` });
      return;
    }
    if (trace === "non-requis") {
      seats.push({ key, label, verdict: "non-atteint", reason: "non requis : le contrat a statué seul" });
      return;
    }
    if (trace === null) {
      const later = traces.slice(index + 1).some((t) => t !== null && t !== "non-requis");
      const waiting = seats.at(-1)?.verdict === "attente";
      seats.push(
        later
          ? { key, label, verdict: "inconnu", reason: journal === null ? "journal non lu pour cette demande" : "aucune trace lue" }
          : { key, label, verdict: "non-atteint", reason: waiting ? "pas encore atteint" : "aucune trace" },
      );
      return;
    }
    seats.push({ key, label, verdict: trace.verdict, reason: trace.reason });
    if (trace.verdict === "veto") stopped = label.toLowerCase();
  });
  return seats;
}

export type Overall = { verdict: "veto" | "attente" | "passe" | "inconnu"; text: string };

/** Ce que la table a décidé : un seul veto suffit. */
export function overall(seats: Seat[]): Overall {
  const veto = seats.find((s) => s.verdict === "veto");
  if (veto) return { verdict: "veto", text: `Veto · ${veto.label}` };
  const waiting = seats.find((s) => s.verdict === "attente");
  if (waiting) return { verdict: "attente", text: `En attente · ${waiting.label}` };
  const contract = seats.find((s) => s.key === "contrat");
  if (contract?.verdict === "passe") return { verdict: "passe", text: "Passée par toutes les couches" };
  return { verdict: "inconnu", text: "Issue non disponible" };
}

export type KnownRequest = { requestId: string; lastMs: number };

/**
 * Demandes connues, les plus récemment vues d'abord. L'ordre mêle horloge du
 * journal, des blocs et de la file : il ne sert qu'à ranger la liste.
 */
export function knownRequests(decisions: RelayDecision[], queue: QueueRow[], journal: JournalEntry[] | null): KnownRequest[] {
  const seen = new Map<string, number>();
  const note = (id: string | null, ms: number): void => {
    if (id === null) return;
    seen.set(id, Math.max(seen.get(id) ?? 0, ms));
  };
  for (const d of decisions) note(d.request_id, d.block_timestamp * 1000);
  for (const r of queue) note(r.request_id, r.updated_at_ms);
  for (const e of journal ?? []) if (e.type !== "ALERT_SENT" && e.component !== "RESPONSE") note(e.request_id, e.ts_ms);
  return [...seen.entries()].map(([requestId, lastMs]) => ({ requestId, lastMs })).sort((a, b) => b.lastMs - a.lastMs);
}
