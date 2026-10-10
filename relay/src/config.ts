// Réglages et constantes du relais. Chaque valeur renvoie au point de
// specs/00-a-trancher.md dont elle est la recommandation par défaut : si la
// décision à quatre change, c'est ici qu'on la change, pas dans le code.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SPECS_DIR = resolve(here, "../../specs");

export type Policy = {
  /** Point p, specs/01 § 4 : durée de vie maximale d'une demande, en secondes. */
  maxTtlS: number;
  /** Point p, specs/01 § 4 : tolérance d'horloge sur issued_at, en secondes. */
  maxClockSkewS: number;
  /** Point p : durée de vie des demandes émises par le client de démo. */
  demoTtlS: number;
  /** Point p, specs/05 § 3 : attente en file qui déclenche l'alerte de disponibilité. */
  queueStallAlertS: number;
  /** Point b : le relais refuse de soumettre la demande d'un agent en pause. */
  relayRefusesPausedAgents: boolean;
  /**
   * Consigne de la branche feat/relais : la file est idempotente par
   * request_id, donc un rejeu n'est soumis qu'une fois. À false, on retrouve
   * le scénario 8 a de specs/acceptance : le rejeu est soumis et c'est le
   * contrat qui le refuse (REQUEST_REPLAYED).
   */
  queueDedupByRequestId: boolean;
  /** Point o : un agent demandeur par scène de démo. */
  oneAgentPerScene: boolean;
  /** Point n : nombre de blocs attendus avant de tenir un événement pour acquis. */
  confirmations: number;
};

export const DEFAULT_POLICY: Policy = {
  maxTtlS: 300,
  maxClockSkewS: 60,
  demoTtlS: 30,
  queueStallAlertS: 15,
  relayRefusesPausedAgents: true,
  queueDedupByRequestId: true,
  oneAgentPerScene: true,
  confirmations: 1,
};

// specs/01 § 5 : domaine EIP-712. Seuls chainId et l'adresse varient.
export const EIP712_NAME = "ArgentVault";
export const EIP712_VERSION = "1";

// specs/contract/IArgentVault.sol. test/abi.test.ts vérifie que ces tables
// suivent le fichier Solidity.
export const ACTION = { PAY_INVOICE: 1, PLACE: 2 } as const;
export type ActionName = keyof typeof ACTION;

export const DECISION = { REFUSED: 0, HUMAN: 1, ACCEPTED: 2 } as const;

export const REASON = {
  NONE: 0,
  INVOICE_UNKNOWN: 1,
  INVOICE_ALREADY_PAID: 2,
  REQUEST_REPLAYED: 3,
  SIGNATURE_INVALID: 4,
  REQUEST_EXPIRED: 5,
  EXCEEDS_PLACEABLE: 6,
  VAULT_PAUSED: 7,
  AGENT_PAUSED: 8,
  AGENT_NOT_AUTHORIZED: 9,
  ABOVE_THRESHOLD: 10,
  APPROVAL_TIMEOUT: 11,
  APPROVAL_REFUSED: 12,
  APPROVED: 13,
  VALIDITY_WINDOW_INVALID: 14,
  ACTION_UNKNOWN: 15,
  PLACEMENT_UNKNOWN: 16,
  PLACEMENT_ALREADY_EXECUTED: 17,
  REF_PENDING_APPROVAL: 18,
  INSUFFICIENT_CASH: 19,
} as const;
export type ReasonName = keyof typeof REASON;

const REASON_NAMES = new Map<number, ReasonName>(
  (Object.entries(REASON) as [ReasonName, number][]).map(([name, code]) => [code, name]),
);

/** Nom d'un motif, ou null pour un code hors de la liste fermée. */
export function reasonName(code: number): ReasonName | null {
  return REASON_NAMES.get(code) ?? null;
}

/**
 * specs/02 § 7 : un code inconnu est traité comme un refus, quelle que soit la
 * décision annoncée à côté.
 */
export function effectiveDecision(decision: number, reason: number): number {
  if (reasonName(reason) === null) return DECISION.REFUSED;
  if (decision !== DECISION.HUMAN && decision !== DECISION.ACCEPTED) return DECISION.REFUSED;
  return decision;
}

// --- Environnement ----------------------------------------------------------
// Les noms sont ceux de relay/.env.example. Aucune valeur n'est journalisée.

export const ENV_NAMES = [
  "RPC_URL",
  "CHAIN_ID",
  "VAULT_ADDRESS",
  "CLIENT_ID",
  "CLIENT_SIGNER",
  "RELAYER",
  "QUEUE_DB",
  "INDEX_DB",
  "START_BLOCK",
  "CONFIRMATIONS",
  "API_PORT",
  "POLL_INTERVAL_MS",
  "JOURNAL_URL",
  "JOURNAL_OUTBOX_DB",
  "PAUSE_SOURCE_URL",
  "CLIENT_IA_PORT",
] as const;
export type EnvName = (typeof ENV_NAMES)[number];

export function readEnv(name: EnvName, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

export function requireEnv(name: EnvName, env: NodeJS.ProcessEnv = process.env): string {
  const value = readEnv(name, env);
  // Le message nomme la variable, jamais sa valeur.
  if (value === undefined) throw new Error(`variable d'environnement manquante : ${name}`);
  return value;
}

export function intEnv(name: EnvName, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = readEnv(name, env);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`variable d'environnement non entière : ${name}`);
  return Number(raw);
}
