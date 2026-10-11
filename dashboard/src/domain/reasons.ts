// Motifs du contrat : liste fermée de specs/02-contrat.md § 7, recopiée ici avec
// un libellé lisible. test/drift.test.ts relit le tableau de la spec et échoue
// si un code n'a pas de libellé, ou si un nom ou une décision a divergé.

export type DecisionKind = "refuse" | "humain" | "accepte";

/** Décisions du contrat : 0 refusé, 1 validation humaine, 2 accepté. */
export const DECISION_KINDS: Record<number, DecisionKind> = { 0: "refuse", 1: "humain", 2: "accepte" };

export const DECISION_WORDS: Record<DecisionKind, string> = {
  refuse: "Refusé",
  humain: "Validation humaine",
  accepte: "Accepté",
};

export type Reason = { name: string; decision: 0 | 1 | 2; label: string };

export const REASONS: Record<number, Reason> = {
  0: { name: "NONE", decision: 2, label: "payé dans la transaction" },
  1: { name: "INVOICE_UNKNOWN", decision: 0, label: "facture inconnue" },
  2: { name: "INVOICE_ALREADY_PAID", decision: 0, label: "facture déjà payée" },
  3: { name: "REQUEST_REPLAYED", decision: 0, label: "demande rejouée" },
  4: { name: "SIGNATURE_INVALID", decision: 0, label: "signature invalide" },
  5: { name: "REQUEST_EXPIRED", decision: 0, label: "demande expirée" },
  6: { name: "EXCEEDS_PLACEABLE", decision: 0, label: "dépasse le plaçable" },
  7: { name: "VAULT_PAUSED", decision: 0, label: "coffre en pause" },
  8: { name: "AGENT_PAUSED", decision: 0, label: "agent en pause" },
  9: { name: "AGENT_NOT_AUTHORIZED", decision: 0, label: "agent sans mandat pour cette action" },
  10: { name: "ABOVE_THRESHOLD", decision: 1, label: "montant au-dessus du seuil" },
  11: { name: "APPROVAL_TIMEOUT", decision: 0, label: "délai d'approbation dépassé" },
  12: { name: "APPROVAL_REFUSED", decision: 0, label: "refusé par l'approbateur" },
  13: { name: "APPROVED", decision: 2, label: "approuvé par un humain" },
  14: { name: "VALIDITY_WINDOW_INVALID", decision: 0, label: "fenêtre de validité invalide" },
  15: { name: "ACTION_UNKNOWN", decision: 0, label: "action inconnue" },
  16: { name: "PLACEMENT_UNKNOWN", decision: 0, label: "placement inconnu" },
  17: { name: "PLACEMENT_ALREADY_EXECUTED", decision: 0, label: "placement déjà exécuté" },
  18: { name: "REF_PENDING_APPROVAL", decision: 0, label: "référence déjà en attente d'approbation" },
  19: { name: "INSUFFICIENT_CASH", decision: 0, label: "cash disponible insuffisant" },
};

export const REASON_SIGNATURE_INVALID = 4;
export const REASON_ABOVE_THRESHOLD = 10;
/** Motifs qui ferment un cas 1 (specs/02 § 6). */
export const CLOSING_REASONS: ReadonlySet<number> = new Set([11, 12, 13]);

export type ReadDecision = {
  kind: DecisionKind;
  /** Libellé du motif, toujours renseigné. */
  reasonLabel: string;
  /** Ligne de synthèse, au féminin : « la demande est ... ». */
  summary: string;
  reasonKnown: boolean;
  /** Renseigné quand la décision annoncée a été ramenée à un refus. */
  downgraded: string | null;
};

/**
 * Lit une décision du contrat. Tout ce qui sort de la liste fermée est traité
 * comme un refus (specs/02 § 7) : motif inconnu, décision hors de 0, 1, 2, ou
 * décision qui ne va pas avec son motif. L'interface n'affiche jamais « accepté »
 * sur la foi d'une donnée qu'elle ne sait pas lire.
 */
export function readDecision(d: { decision: number; reason: number; effective_decision: number }): ReadDecision {
  const reason = REASONS[d.reason];
  if (!reason) {
    const reasonLabel = `motif ${d.reason} inconnu, traité comme un refus`;
    return { kind: "refuse", reasonLabel, summary: `refusée : ${reasonLabel}`, reasonKnown: false, downgraded: null };
  }
  const announced = DECISION_KINDS[d.decision];
  let downgraded: string | null = null;
  if (!announced) downgraded = `décision ${d.decision} inconnue, traitée comme un refus`;
  else if (d.decision !== reason.decision) downgraded = "décision et motif incohérents, traité comme un refus";
  else if (d.effective_decision !== d.decision) downgraded = "décision ramenée à un refus par l'indexeur";
  if (downgraded || !announced) {
    return { kind: "refuse", reasonLabel: reason.label, summary: `refusée : ${downgraded}`, reasonKnown: true, downgraded };
  }
  const summary =
    announced === "accepte"
      ? d.reason === 13
        ? "approuvée et payée"
        : "acceptée et payée"
      : announced === "humain"
        ? "en attente d'approbation"
        : `refusée par le contrat : ${reason.label}`;
  return { kind: announced, reasonLabel: reason.label, summary, reasonKnown: true, downgraded: null };
}

export const ACTION_LABELS: Record<number, string> = { 1: "paiement de facture", 2: "placement" };

export function actionLabel(action: number): string {
  return ACTION_LABELS[action] ?? `action ${action} inconnue`;
}
