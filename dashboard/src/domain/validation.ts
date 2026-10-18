// « À valider » : les cas 1 et leur issue, les contrôles que le contrat et la
// porte d'entrée ont passés, l'historique lu au journal. Chaque contrôle se
// déduit d'un motif du contrat ou d'une entrée DETECTION : jamais d'un texte
// rédigé par un agent, jamais d'une donnée que la console n'a pas lue.
import type { JournalEntry, RelayDecision, RelayEvent } from "../api/types.ts";
import { pendingCases, type PendingCase } from "./activity.ts";
import { registeredAmount } from "./apercu.ts";
import { detectorCodeLabel } from "./labels.ts";
import { REASON_ABOVE_THRESHOLD } from "./reasons.ts";

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const WEI = /^(0|[1-9][0-9]{0,77})$/;
const ordered = <T extends { block_number: number; log_index: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);

export type CaseState = "attente" | "valide" | "rejete" | "expire";

export const CASE_STATE_WORDS: Record<CaseState, string> = {
  attente: "À valider",
  valide: "Validé",
  rejete: "Rejeté",
  expire: "Expiré",
};

/** Issue d'un cas 1 : motif de la décision qui l'a fermé (specs/02 § 6). */
const CLOSURES: Record<number, Exclude<CaseState, "attente">> = { 13: "valide", 12: "rejete", 11: "expire" };

export type ClosedCase = {
  requestId: string;
  refId: string;
  agentId: string;
  action: number;
  state: Exclude<CaseState, "attente">;
  /** Montant du HoldPlaced de l'ouverture. */
  amountWei: string | null;
  /** Bloc et heure de bloc de la clôture. */
  closedBlock: number;
  closedAtS: number;
};

/** Cas 1 fermés : une décision 1 au motif ABOVE_THRESHOLD, puis une clôture sous la même demande. */
export function closedCases(decisions: RelayDecision[], events: RelayEvent[]): ClosedCase[] {
  const opened = new Map<string, RelayDecision>();
  const closed: ClosedCase[] = [];
  for (const d of ordered(decisions)) {
    if (d.decision === 1 && d.reason === REASON_ABOVE_THRESHOLD && d.effective_decision === 1) {
      opened.set(d.request_id, d);
      continue;
    }
    const state = CLOSURES[d.reason];
    const open = opened.get(d.request_id);
    if (!state || !open) continue;
    opened.delete(d.request_id);
    const hold = events.find((e) => e.name === "HoldPlaced" && e.args.requestId === d.request_id);
    const amount = hold ? str(hold.args.amount) : null;
    closed.push({
      requestId: d.request_id,
      refId: open.ref_id,
      agentId: open.agent_id,
      action: open.action,
      state,
      amountWei: amount !== null && WEI.test(amount) ? amount : null,
      closedBlock: d.block_number,
      closedAtS: d.block_timestamp,
    });
  }
  return closed.reverse();
}

/** Cas ouverts, avec l'agent de la décision : PendingCase ne le porte pas. */
export type OpenCase = PendingCase & { agentId: string };

export function openCases(decisions: RelayDecision[], events: RelayEvent[]): OpenCase[] {
  const agents = new Map(decisions.map((d) => [d.request_id, d.agent_id]));
  return pendingCases(decisions, events)
    .map((c) => ({ ...c, agentId: agents.get(c.requestId) ?? "" }))
    .sort((a, b) => (a.deadline ?? Number.MAX_SAFE_INTEGER) - (b.deadline ?? Number.MAX_SAFE_INTEGER));
}

export type ControlState = "ok" | "attention" | "inconnu";

export type Control = {
  key: string;
  /** Libellé métier. */
  label: string;
  state: ControlState;
  detail: string;
  /** Motif ou code technique, montré en détail seulement. */
  code: string | null;
};

/** Dernière valeur d'un paramètre inscrite au plus tard au bloc donné. */
function settingAt(events: RelayEvent[], name: string, block: number): string | null {
  const last = ordered(events)
    .filter((e) => e.name === name && e.block_number <= block)
    .at(-1);
  const value = last ? str(last.args.current) : null;
  return value !== null && WEI.test(value) ? value : null;
}

/**
 * Contrôles d'un cas en attente. Le contrat ne renvoie une demande à un humain
 * (décision 1, ABOVE_THRESHOLD) qu'après avoir vérifié la référence, l'agent et,
 * pour un placement, le plaçable : ces contrôles sont donc passés, et se lisent
 * dans le motif. Le seuil dépassé est la raison de l'attente. Le contrôle
 * d'entrée se lit dans l'entrée DETECTION du journal, si le journal est du même
 * monde que le relais ; sinon : inconnu.
 *
 * `format` met un montant en forme (unité d'affichage) : le domaine ne choisit pas l'unité.
 */
export function controlsFor(
  c: OpenCase,
  events: RelayEvent[],
  journal: JournalEntry[] | null,
  format: (wei: string | null) => string,
): Control[] {
  const placement = c.action === 2;
  const registration = events.find(
    (e) =>
      (e.name === "InvoiceRegistered" && e.args.invoiceId === c.refId) || (e.name === "PlacementRegistered" && e.args.placementId === c.refId),
  );
  const beneficiary = c.beneficiaryId === null ? undefined : events.find((e) => e.name === "BeneficiaryRegistered" && e.args.beneficiaryId === c.beneficiaryId);
  const threshold = settingAt(events, "ThresholdChanged", c.blockNumber);
  const controls: Control[] = [
    {
      key: "reference",
      label: placement ? "Placement enregistré" : "Facture enregistrée",
      state: "ok",
      detail: registration ? `inscrite au bloc ${registration.block_number}, ${format(registeredAmount(c.refId, events))}` : "inscription non lue, mais le contrat l'a reconnue",
      code: placement ? "PLACEMENT_UNKNOWN non levé" : "INVOICE_UNKNOWN non levé",
    },
    {
      key: "beneficiaire",
      label: "Bénéficiaire enregistré",
      state: beneficiary ? "ok" : "inconnu",
      detail: beneficiary ? `inscrit au bloc ${beneficiary.block_number}` : "inscription non lue",
      code: null,
    },
    {
      key: "agent",
      label: "Agent autorisé pour cette action",
      state: "ok",
      detail: placement ? "mandat : placer" : "mandat : payer une facture",
      code: "AGENT_NOT_AUTHORIZED non levé",
    },
  ];
  if (placement) {
    controls.push({ key: "placable", label: "Dans le montant plaçable", state: "ok", detail: "vérifié par le contrat avant le seuil", code: "EXCEEDS_PLACEABLE non levé" });
  }
  controls.push({
    key: "seuil",
    label: "Seuil de validation",
    state: "attention",
    detail: threshold === null ? `${format(c.amountWei)} au-dessus du seuil` : `${format(c.amountWei)} au-dessus du seuil de ${format(threshold)}`,
    code: "ABOVE_THRESHOLD",
  });
  const detection = journal?.find((e) => e.type === "DETECTION" && e.request_id === c.requestId);
  if (!detection) {
    controls.push({
      key: "entree",
      label: "Contrôle d'entrée",
      state: "inconnu",
      detail: journal === null ? "non disponible : journal non lu ou d'un autre monde" : "aucune entrée DETECTION pour cette demande",
      code: null,
    });
  } else {
    const score = int(detection.data.score);
    const limit = int(detection.data.threshold);
    const codes = Array.isArray(detection.data.reason_codes) ? detection.data.reason_codes.filter((x): x is string => typeof x === "string") : [];
    const passed = detection.data.verdict === "PASS";
    controls.push({
      key: "entree",
      label: "Contrôle d'entrée",
      state: passed && codes.length === 0 ? "ok" : "attention",
      detail: [
        passed ? "laissée passer" : "verdict inattendu",
        score !== null && limit !== null ? `score ${score} pour un seuil de ${limit}` : null,
        codes.length > 0 ? codes.map(detectorCodeLabel).join(", ") : null,
      ]
        .filter((p) => p !== null)
        .join(" · "),
      code: codes.length > 0 ? codes.join(", ") : "DETECTION PASS",
    });
  }
  return controls;
}

/** Libellés des entrées du journal citées dans l'historique d'une demande. */
const HISTORY_LABELS: Record<string, string> = {
  REQUEST_RECEIVED: "Demande reçue à la porte d'entrée",
  DETECTION: "Contrôle d'entrée",
  REQUEST_PARSED: "Demande lue : action et référence",
  FORWARDED_TO_CLIENT_AI: "Transmise à l'IA du client",
  REQUEST_SIGNED: "Signée par l'IA du client",
  ENQUEUED: "Mise en file",
  SUBMITTED: "Soumise au contrat par le relais",
  DECISION_OBSERVED: "Décision lue par le service de réponse",
  ALERT_SENT: "Alerte envoyée",
  QUEUE_EXPIRED: "Expirée en file",
};

export type HistoryLine = { key: string; label: string; atMs: number; clock: "journal" | "bloc" };

/** Historique d'une demande : ses entrées de journal (horloge du journal) et ses événements du contrat (horloge du bloc). */
export function historyFor(requestId: string, journal: JournalEntry[] | null, decisions: RelayDecision[]): HistoryLine[] {
  const lines: HistoryLine[] = [];
  for (const e of journal ?? []) {
    if (e.request_id !== requestId) continue;
    lines.push({ key: `j${e.seq}`, label: HISTORY_LABELS[e.type] ?? e.type, atMs: e.ts_ms, clock: "journal" });
  }
  for (const d of decisions) {
    if (d.request_id !== requestId) continue;
    lines.push({
      key: `d${d.tx_hash}:${d.log_index}`,
      label: d.decision === 1 ? "Renvoyée à un humain par le contrat, montant bloqué" : `Décision ${d.decision} du contrat`,
      atMs: d.block_timestamp * 1000,
      clock: "bloc",
    });
  }
  return lines.sort((a, b) => a.atMs - b.atMs);
}

/**
 * Temps restant avant l'échéance (heure de bloc) comparée à l'horloge locale :
 * une estimation, que l'écran dit comme telle. null : échéance non lue.
 */
export function remainingS(deadline: number | null, nowMs: number): number | null {
  return deadline === null ? null : deadline - Math.floor(nowMs / 1000);
}

/** « 3 h 07 », « 12 min 05 s », « 42 s ». */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
  if (s >= 60) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${s} s`;
}
