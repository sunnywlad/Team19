// Référentiels et règles, tels que le contrat les a inscrits : fournisseurs
// (BeneficiaryRegistered), agents (AgentRegistered) et paramètres du coffre.
// Lecture seule : rien ici ne se modifie depuis la console.
import type { JournalEntry, PausedAgent, RelayDecision, RelayEvent, VaultState } from "../api/types.ts";
import { chainPausedAgents } from "./activity.ts";
import { readDecision } from "./reasons.ts";

const WEI = /^(0|[1-9][0-9]{0,77})$/;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const weiOf = (v: unknown): bigint | null => (typeof v === "string" && WEI.test(v) ? BigInt(v) : null);
const ordered = (events: RelayEvent[]): RelayEvent[] => [...events].sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);

/** Bits du mandat (specs/02 § 3) : 1 payer une facture, 2 placer. */
export const MANDATE_BITS: [number, string][] = [
  [1, "payer une facture"],
  [2, "placer"],
];

/** Mandat en mots. 0 : aucune action, l'agent ne peut que lire. Bit inconnu : dit tel quel, jamais ignoré. */
export function mandateWords(mandate: number | null): string[] {
  if (mandate === null) return ["mandat non lu"];
  if (mandate === 0) return ["aucune action : lecture seule"];
  const words = MANDATE_BITS.filter(([bit]) => (mandate & bit) !== 0).map(([, word]) => word);
  const unknown = mandate & ~MANDATE_BITS.reduce((all, [bit]) => all | bit, 0);
  if (unknown !== 0) words.push(`bits inconnus (${unknown})`);
  return words;
}

export type AgentStatus = "actif" | "pause-hors-chaine" | "pause-chaine" | "pause-deux";

export type AgentRow = {
  agentId: string;
  /** Mandat de la dernière inscription. null : agent vu dans une décision sans inscription lue. */
  mandate: number | null;
  registeredBlock: number | null;
  paid: number;
  blocked: number;
  status: AgentStatus;
  /** false : pauses hors chaîne non lues (service de réponse injoignable ou d'un autre monde). */
  offchainKnown: boolean;
};

/**
 * Agents : ceux que le contrat a inscrits, plus ceux qu'une décision cite sans
 * inscription lue. Paiements : décisions lues comme acceptées. Bloqués : refus
 * du contrat, et blocages à la porte si le journal est du même monde. Statut :
 * pause hors chaîne (service de réponse), pause sur la chaîne (événements).
 */
export function agentRows(
  events: RelayEvent[],
  decisions: RelayDecision[],
  paused: PausedAgent[] | null,
  journal: JournalEntry[] | null,
): AgentRow[] {
  const rows = new Map<string, AgentRow>();
  const row = (agentId: string): AgentRow => {
    let found = rows.get(agentId);
    if (!found) {
      found = { agentId, mandate: null, registeredBlock: null, paid: 0, blocked: 0, status: "actif", offchainKnown: paused !== null };
      rows.set(agentId, found);
    }
    return found;
  };
  for (const e of ordered(events)) {
    if (e.name !== "AgentRegistered") continue;
    const agentId = str(e.args.agentId);
    const mandate = e.args.mandate;
    if (agentId === null) continue;
    const r = row(agentId);
    r.mandate = typeof mandate === "number" && Number.isSafeInteger(mandate) ? mandate : typeof mandate === "string" && /^\d{1,3}$/.test(mandate) ? Number(mandate) : null;
    r.registeredBlock = e.block_number;
  }
  for (const d of decisions) {
    // specs/02 § 8 : l'agent d'une signature invalide n'est pas un fait.
    if (d.reason === 4) continue;
    const kind = readDecision(d).kind;
    if (kind === "accepte") row(d.agent_id).paid += 1;
    else if (kind === "refuse" && d.reason !== 12) row(d.agent_id).blocked += 1;
  }
  for (const entry of journal ?? []) {
    if (entry.type === "DETECTION" && entry.data.verdict === "BLOCK" && entry.agent_id !== null) row(entry.agent_id).blocked += 1;
  }
  const offchain = new Set((paused ?? []).filter((p) => p.scope === "OFFCHAIN").map((p) => p.agent_id));
  const onchain = new Set(chainPausedAgents(events).map((p) => p.agentId));
  for (const r of rows.values()) {
    const off = offchain.has(r.agentId);
    const on = onchain.has(r.agentId);
    r.status = off && on ? "pause-deux" : off ? "pause-hors-chaine" : on ? "pause-chaine" : "actif";
  }
  return [...rows.values()];
}

export type BeneficiaryRow = {
  beneficiaryId: string;
  /** Compte inscrit au contrat : une adresse, abrégée à l'affichage. */
  account: string | null;
  registeredBlock: number;
  registeredAtS: number;
  invoices: number;
  /** Somme des factures inscrites. Un montant illisible n'y entre pas : il est compté dans `unknown`. */
  invoicedWei: string;
  paidCount: number;
  paidWei: string;
  unknown: number;
};

/** Fournisseurs : BeneficiaryRegistered, avec les factures et les paiements qui les citent. */
export function beneficiaryRows(events: RelayEvent[]): BeneficiaryRow[] {
  const rows = new Map<string, BeneficiaryRow & { invoiced: bigint; paid: bigint }>();
  for (const e of ordered(events)) {
    if (e.name !== "BeneficiaryRegistered") continue;
    const id = str(e.args.beneficiaryId);
    if (id === null) continue;
    rows.set(id, {
      beneficiaryId: id,
      account: str(e.args.account),
      registeredBlock: e.block_number,
      registeredAtS: e.block_timestamp,
      invoices: 0,
      invoicedWei: "0",
      paidCount: 0,
      paidWei: "0",
      unknown: 0,
      invoiced: 0n,
      paid: 0n,
    });
  }
  for (const e of events) {
    const r = rows.get(str(e.args.beneficiaryId) ?? "");
    if (!r) continue;
    const wei = weiOf(e.args.amount);
    if (e.name === "InvoiceRegistered") {
      r.invoices += 1;
      if (wei === null) r.unknown += 1;
      else r.invoiced += wei;
    } else if (e.name === "Paid") {
      r.paidCount += 1;
      if (wei === null) r.unknown += 1;
      else r.paid += wei;
    }
  }
  return [...rows.values()].map(({ invoiced, paid, ...r }) => ({ ...r, invoicedWei: invoiced.toString(), paidWei: paid.toString() }));
}

/** Dernière valeur d'un paramètre, et le bloc où elle a été posée. */
export type Setting<T> = { value: T; block: number; atS: number } | null;

function lastChange<T>(events: RelayEvent[], name: string, read: (v: unknown) => T | null): Setting<T> {
  const last = ordered(events)
    .filter((e) => e.name === name)
    .at(-1);
  if (!last) return null;
  const value = read(last.args.current);
  return value === null ? null : { value, block: last.block_number, atS: last.block_timestamp };
}

export type Rules = {
  /** Lus dans GET /vault, au bloc de la lecture. null : vue non lue. */
  thresholdWei: string | null;
  safetyReserveWei: string | null;
  vaultPaused: boolean | null;
  vaultBlock: number | null;
  /** Dernière inscription des paramètres dans les événements. */
  thresholdChange: Setting<string>;
  reserveChange: Setting<string>;
  /** Délai de réponse de l'approbateur, en secondes : ApprovalDelayChanged. */
  approvalDelay: Setting<number>;
};

export function rulesOf(vault: VaultState | null, events: RelayEvent[] | null): Rules {
  const evts = events ?? [];
  const wei = (v: unknown): string | null => (typeof v === "string" && WEI.test(v) ? v : null);
  const seconds = (v: unknown): number | null =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : typeof v === "string" && /^\d{1,12}$/.test(v) ? Number(v) : null;
  return {
    thresholdWei: vault?.threshold_wei ?? null,
    safetyReserveWei: vault?.safety_reserve_wei ?? null,
    vaultPaused: vault?.vault_paused ?? null,
    vaultBlock: vault?.block_number ?? null,
    thresholdChange: events === null ? null : lastChange(evts, "ThresholdChanged", wei),
    reserveChange: events === null ? null : lastChange(evts, "SafetyReserveChanged", wei),
    approvalDelay: events === null ? null : lastChange(evts, "ApprovalDelayChanged", seconds),
  };
}

/** Durée en secondes, en mots : « 30 s », « 4 min », « 4 h », « 1 h 30 min ». */
export function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [h > 0 ? `${h} h` : null, m > 0 ? `${m} min` : null, s > 0 ? `${s} s` : null].filter((p) => p !== null);
  return parts.join(" ");
}
