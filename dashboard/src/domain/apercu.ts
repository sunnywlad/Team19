// Vue d'ensemble : des comptes sur les mêmes lectures que les autres écrans.
// Rien n'est estimé : un montant qu'on ne sait pas lire n'entre dans aucun
// total, et le nombre de ces montants inconnus est donné à côté. Un total
// partiel se lirait comme un total.
import type { DailyStats, JournalEntry, RelayDecision, RelayEvent } from "../api/types.ts";
import type { PendingCase } from "./activity.ts";
import { readDecision } from "./reasons.ts";

const WEI = /^(0|[1-9][0-9]{0,77})$/;
const weiOf = (v: unknown): bigint | null => (typeof v === "string" && WEI.test(v) ? BigInt(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Somme connue et nombre de montants qui n'ont pas pu être lus. */
export type Sum = { count: number; knownWei: string; unknown: number };

function sum(amounts: (bigint | null)[]): Sum {
  let total = 0n;
  let unknown = 0;
  for (const a of amounts) {
    if (a === null) unknown += 1;
    else total += a;
  }
  return { count: amounts.length, knownWei: total.toString(), unknown };
}

/** Paiements exécutés : les événements Paid, leur nombre et leur somme. */
export function paidSummary(events: RelayEvent[]): Sum {
  return sum(events.filter((e) => e.name === "Paid").map((e) => weiOf(e.args.amount)));
}

export const REASON_NONE = 0;
export const REASON_APPROVED = 13;
export const REASON_APPROVAL_REFUSED = 12;

/**
 * Part des paiements passés sans intervention humaine : décision 2 au motif
 * NONE, contre décision 2 au motif APPROVED. Une décision que le dashboard ne
 * sait pas lire n'est pas un paiement (readDecision la ramène à un refus).
 * null : aucun paiement, pas de part à donner.
 */
export function interventionShare(decisions: RelayDecision[]): { auto: number; approved: number; share: number | null } {
  let auto = 0;
  let approved = 0;
  for (const d of decisions) {
    if (readDecision(d).kind !== "accepte") continue;
    if (d.reason === REASON_NONE) auto += 1;
    else if (d.reason === REASON_APPROVED) approved += 1;
  }
  const total = auto + approved;
  return { auto, approved, share: total === 0 ? null : auto / total };
}

/** À valider : les cas 1 ouverts et le montant qu'ils bloquent. */
export function pendingSummary(cases: PendingCase[]): Sum {
  return sum(cases.map((c) => weiOf(c.amountWei)));
}

/** Montant inscrit d'une référence : InvoiceRegistered ou PlacementRegistered. null : référence inconnue du contrat. */
export function registeredAmount(refId: string | null, events: RelayEvent[]): string | null {
  if (refId === null) return null;
  const registration = events.find(
    (e) => (e.name === "InvoiceRegistered" && e.args.invoiceId === refId) || (e.name === "PlacementRegistered" && e.args.placementId === refId),
  );
  const wei = registration ? weiOf(registration.args.amount) : null;
  return wei === null ? null : wei.toString();
}

/** Une demande arrêtée par une règle : refus du contrat, ou blocage à la porte d'entrée. */
export type Blocked = {
  key: string;
  origin: "contrat" | "porte";
  requestId: string | null;
  agentId: string | null;
  refId: string | null;
  /** Montant inscrit de la référence. null : « montant inconnu », jamais 0. */
  amountWei: string | null;
  /** Horodatage en millisecondes, sur l'horloge de sa source (bloc ou journal). */
  atMs: number;
};

/**
 * Bloqués par une règle : les refus du contrat (décision 0, ou décision qu'il
 * ne sait pas lire), sauf le refus d'un approbateur, qui est un humain ; et les
 * demandes bloquées à la porte d'entrée (DETECTION, verdict BLOCK). Le montant
 * non sorti est le montant inscrit de la référence : pour un blocage à la
 * porte, la référence vient de REQUEST_PARSED dans le journal, et seulement si
 * le journal et le relais sont du même monde.
 */
export function blockedRequests(decisions: RelayDecision[], events: RelayEvent[], journal: JournalEntry[] | null, linked: boolean): Blocked[] {
  const out: Blocked[] = [];
  for (const d of decisions) {
    if (readDecision(d).kind !== "refuse" || d.reason === REASON_APPROVAL_REFUSED) continue;
    out.push({
      key: `contrat:${d.tx_hash}:${d.log_index}`,
      origin: "contrat",
      requestId: d.request_id,
      agentId: d.agent_id,
      refId: d.ref_id,
      amountWei: registeredAmount(d.ref_id, events),
      atMs: d.block_timestamp * 1000,
    });
  }
  for (const entry of journal ?? []) {
    if (entry.type !== "DETECTION" || entry.data.verdict !== "BLOCK") continue;
    const parsed = linked ? journal?.find((e) => e.type === "REQUEST_PARSED" && e.request_id !== null && e.request_id === entry.request_id) : undefined;
    const refId = parsed ? str(parsed.data.ref_id) : null;
    out.push({
      key: `porte:${entry.seq}`,
      origin: "porte",
      requestId: entry.request_id,
      agentId: entry.agent_id,
      refId,
      amountWei: linked ? registeredAmount(refId, events) : null,
      atMs: entry.ts_ms,
    });
  }
  return out.sort((a, b) => b.atMs - a.atMs);
}

export function blockedSummary(blocked: Blocked[]): Sum {
  return sum(blocked.map((b) => weiOf(b.amountWei)));
}

export type Day = {
  /** Minuit local du jour, en millisecondes. */
  startMs: number;
  auto: number;
  approved: number;
  blocked: number;
};

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Décisions par jour, sur les `days` derniers jours (aujourd'hui compris), au
 * jour local du navigateur. Payés automatiquement et payés après validation :
 * jour du bloc de la décision. Bloqués : jour du bloc pour un refus du contrat,
 * jour de l'écriture au journal pour un blocage à la porte. Un jour sans rien
 * vaut zéro : c'est un compte, pas une valeur absente.
 */
export function decisionsByDay(decisions: RelayDecision[], blocked: Blocked[], now: number, days: number): Day[] {
  const today = startOfDay(now);
  const out: Day[] = [];
  for (let i = days - 1; i >= 0; i--) {
    // Pas de 24 h fixes : un changement d'heure ferait glisser les jours.
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push({ startMs: d.getTime(), auto: 0, approved: 0, blocked: 0 });
  }
  const slot = (ms: number): Day | undefined => {
    const start = startOfDay(ms);
    return out.find((day) => day.startMs === start);
  };
  for (const d of decisions) {
    if (readDecision(d).kind !== "accepte") continue;
    const day = slot(d.block_timestamp * 1000);
    if (!day) continue;
    if (d.reason === REASON_NONE) day.auto += 1;
    else if (d.reason === REASON_APPROVED) day.approved += 1;
  }
  for (const b of blocked) {
    const day = slot(b.atMs);
    if (day) day.blocked += 1;
  }
  return out;
}

/** Plus grande pile du graphique, arrondie vers le haut pour des graduations lisibles. Au moins 4. */
export function chartMax(days: Day[]): number {
  const top = Math.max(0, ...days.map((d) => d.auto + d.approved + d.blocked));
  if (top <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(top));
  return Math.ceil(top / step) * step;
}

/**
 * Chiffres de la période lus dans GET /stats/daily (API-NEEDS.md § 9) : la
 * source les a comptés sur tous ses événements, pas seulement sur les 500 que
 * la console a lus. Les mêmes définitions que paidSummary, interventionShare
 * et blockedRequests.
 */
export type StatsSummary = {
  days: number;
  paid: Sum;
  auto: number;
  approved: number;
  share: number | null;
  blocked: Sum;
  gate: number;
};

export function statsSummary(stats: DailyStats): StatsSummary {
  let auto = 0;
  let approved = 0;
  let paidWei = 0n;
  let blocked = 0;
  let gate = 0;
  let blockedWei = 0n;
  let unknown = 0;
  for (const d of stats.days) {
    auto += d.paid_auto;
    approved += d.paid_approved;
    paidWei += BigInt(d.paid_auto_wei) + BigInt(d.paid_approved_wei);
    blocked += d.blocked;
    gate += d.blocked_gate;
    blockedWei += BigInt(d.blocked_wei);
    unknown += d.blocked_unknown;
  }
  const total = auto + approved;
  return {
    days: stats.days.length,
    paid: { count: total, knownWei: paidWei.toString(), unknown: 0 },
    auto,
    approved,
    share: total === 0 ? null : auto / total,
    blocked: { count: blocked, knownWei: blockedWei.toString(), unknown },
    gate,
  };
}

/** Les `days` derniers jours des agrégats, pour le graphique. Le jour vient de la source, daté à minuit local pour l'affichage. */
export function statsDays(stats: DailyStats, days: number): Day[] {
  return stats.days.slice(-days).map((d) => {
    const [y, m, day] = d.date.split("-").map(Number) as [number, number, number];
    return { startMs: new Date(y, m - 1, day).getTime(), auto: d.paid_auto, approved: d.paid_approved, blocked: d.blocked };
  });
}
