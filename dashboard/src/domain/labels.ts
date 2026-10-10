// Libellés des listes fermées de specs/03, 04 et 05. Un code hors liste garde un
// affichage : « code inconnu », jamais une erreur.
import type { AutomaticAction, IncidentTrigger } from "../api/types.ts";

const DETECTOR_CODES: Record<string, string> = {
  INSTRUCTION_IN_DATA: "instruction dans une donnée",
  AUTHORITY_VIOLATION: "violation d'autorité",
  PAYMENT_ANOMALY: "anomalie de paiement",
  SCHEMA_INVALID: "schéma invalide",
  TOKEN_INVALID: "jeton invalide",
  RATE_LIMITED: "limite de débit dépassée",
};

export function detectorCodeLabel(code: string): string {
  return DETECTOR_CODES[code] ?? "code inconnu, traité comme un blocage";
}

export const TRIGGER_LABELS: Record<IncidentTrigger, string> = {
  DETECTOR_SCORE: "score du détecteur",
  SCHEMA_REJECTED: "schéma rejeté",
  CONTRACT_REFUSAL: "refus du contrat",
  RATE_BURST: "rafale de demandes",
  REPEATED_REFUSALS: "refus répétés",
};

export const ACTION_TAKEN_LABELS: Record<AutomaticAction, string> = {
  QUARANTINE: "quarantaine",
  AGENT_PAUSE_OFFCHAIN: "pause de l'agent (hors chaîne)",
  AGENT_PAUSE_ONCHAIN: "pause de l'agent (sur la chaîne)",
  ALERT: "alerte",
  REPORT: "rapport d'incident",
};

const ALERT_KINDS: Record<string, string> = {
  SECURITY: "alerte de sécurité",
  REPETITION: "alerte de répétition",
  AVAILABILITY: "alerte de disponibilité",
  APPROVAL_REQUESTED: "notification à l'approbateur",
};

export function alertKindLabel(kind: string): string {
  return ALERT_KINDS[kind] ?? "alerte de type inconnu";
}

const AUTH_CAUSES: Record<string, string> = {
  TOKEN_MISSING: "jeton absent",
  TOKEN_EXPIRED: "jeton expiré",
  TOKEN_REVOKED: "jeton révoqué",
  TOKEN_UNKNOWN: "jeton inconnu",
  AGENT_MISMATCH: "jeton d'un autre agent",
};

export function authCauseLabel(cause: string): string {
  return AUTH_CAUSES[cause] ?? "cause inconnue";
}

export const HUMAN_DECISION_LABELS: Record<string, string> = {
  FALSE_POSITIVE: "faux positif",
  ATTACK_CONFIRMED: "attaque confirmée",
  AGENT_RESUMED: "agent repris",
  TOKEN_REVOKED: "jeton révoqué",
  VAULT_PAUSED: "coffre mis en pause",
  VAULT_RESUMED: "coffre repris",
};

export const ROLE_LABELS: Record<string, string> = { ANALYST: "analyste", OWNER: "propriétaire", APPROVER: "approbateur" };

export const MANDATE_LABELS: Record<string, string> = { PAY_INVOICE: "payer une facture", PLACE: "placer" };
