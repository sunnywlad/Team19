// Formes lues par le dashboard. Les types suivent les schémas : ceux de
// specs/schemas (journal, incident) et ceux de dashboard/schemas (API du relais,
// dérivés de relay/src/indexer.ts et relay/src/queue.ts ; points proposés).
// Une valeur de ces types a toujours passé son validateur (src/validation).

/** relay/src/indexer.ts, IndexedDecision. */
export type RelayDecision = {
  id: number;
  request_id: string;
  agent_id: string;
  client_id: string;
  action: number;
  decision: number;
  reason: number;
  reason_name: string | null;
  effective_decision: number;
  ref_id: string;
  tx_hash: string;
  log_index: number;
  block_number: number;
  /** Horodatage du bloc, en secondes. */
  block_timestamp: number;
};

/** relay/src/indexer.ts, IndexedEvent. */
export type RelayEvent = {
  id: number;
  name: string;
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_timestamp: number;
  request_id: string | null;
  args: Record<string, string | number | boolean>;
};

export type QueueStatus = "PENDING" | "SUBMITTING" | "SUBMITTED" | "EXPIRED" | "REJECTED" | "IN_DOUBT";

/** relay/src/queue.ts, QueueRow. */
export type QueueRow = {
  id: number;
  request_id: string;
  agent_id: string;
  client_id: string;
  expires_at: number;
  status: QueueStatus;
  enqueued_at_ms: number;
  updated_at_ms: number;
  attempts: number;
  tx_hash: string | null;
  /** Texte libre du relais : contenu non fiable. */
  cause: string | null;
};

export type RelayStatus = { next_block: string; confirmations: number; events: number };

/** PROPOSÉ, API-NEEDS.md § 1. Chaque montant vient d'une vue du contrat ; null si la vue n'a pas pu être lue. */
export type VaultState = {
  block_number: number;
  block_timestamp: number;
  cash_wei: string | null;
  admitted_debts_wei: string | null;
  safety_reserve_wei: string | null;
  total_held_wei: string | null;
  held_placements_wei: string | null;
  placeable_wei: string | null;
  threshold_wei: string | null;
  vault_paused: boolean | null;
};

export type DetectorReasonCode =
  | "INSTRUCTION_IN_DATA"
  | "AUTHORITY_VIOLATION"
  | "PAYMENT_ANOMALY"
  | "SCHEMA_INVALID"
  | "TOKEN_INVALID"
  | "RATE_LIMITED";

export type IncidentTrigger = "DETECTOR_SCORE" | "SCHEMA_REJECTED" | "CONTRACT_REFUSAL" | "RATE_BURST" | "REPEATED_REFUSALS";

export type AutomaticAction = "QUARANTINE" | "AGENT_PAUSE_OFFCHAIN" | "AGENT_PAUSE_ONCHAIN" | "ALERT" | "REPORT";

/** specs/schemas/incident-report.schema.json. */
export type IncidentReport = {
  report_version: 1;
  incident_id: string;
  generated_at_ms: number;
  trigger: IncidentTrigger;
  request_ids: string[];
  authority_chain: {
    agent_id: string;
    agent_mandate: ("PAY_INVOICE" | "PLACE")[];
    client_id: string;
    client_signer: string | null;
    request_digest: string | null;
    relay_tx_hash: string | null;
  };
  timestamps: {
    received_at_ms: number;
    detected_at_ms: number;
    observed_at_ms: number | null;
    paused_at_ms: number | null;
    alerted_at_ms: number | null;
  };
  detector: { score: number | null; threshold: number; reason_codes: DetectorReasonCode[] };
  contract: null | { decision: 0 | 1 | 2; reason: number; tx_hash: string; block_number: number; block_timestamp: number };
  amounts: { exposed_wei: string | null; out_wei: string };
  automatic_actions: { action: AutomaticAction; at_ms: number; journal_seq: number }[];
  human_decision: null | {
    decision: "FALSE_POSITIVE" | "ATTACK_CONFIRMED" | "AGENT_RESUMED" | "TOKEN_REVOKED" | "VAULT_PAUSED" | "VAULT_RESUMED";
    author_role: "ANALYST" | "OWNER" | "APPROVER";
    author_id: string;
    at_ms: number;
    journal_seq: number;
  };
  journal_head: { seq: number; hash: string };
};

/** PROPOSÉ, API-NEEDS.md § 2. */
export type IncidentItem = { report: IncidentReport; quarantine_excerpt: string | null };

/** specs/schemas/journal-entry.schema.json. « data » dépend de « type ». */
export type JournalEntry = {
  v: 1;
  seq: number;
  ts_ms: number;
  type: string;
  component: "GATEWAY" | "CLIENT_AI" | "QUEUE" | "RELAY" | "RESPONSE" | "HUMAN";
  request_id: string | null;
  agent_id: string | null;
  client_id: string | null;
  data: Record<string, unknown>;
  prev_hash: string;
  hash: string;
};

/** PROPOSÉ, API-NEEDS.md § 3. */
export type JournalVerification = {
  head: { seq: number; hash: string } | null;
  verification: null | {
    verified_at_ms: number;
    result: "OK" | "BROKEN" | "FORMAT" | "HEAD_MISMATCH";
    defect: null | "SEQ_MISMATCH" | "PREV_MISMATCH" | "HASH_MISMATCH" | "FORMAT" | "HEAD_MISMATCH";
    defect_seq: number | null;
    entries: number;
    head_seq: number | null;
    head_hash: string | null;
    expected_head_checked: boolean;
  };
};

/** PROPOSÉ, API-NEEDS.md § 4. */
export type PausedAgent = { agent_id: string; scope: "OFFCHAIN" | "ONCHAIN"; incident_id: string | null; paused_at_ms: number };

/** D'où vient une famille de données. */
export type Source = "reel" | "simulation";
export type Sources = { relay: Source; vault: Source; response: Source };

/**
 * Ce que le relais réel a derrière lui, dit par le proxy local (/api/local/mode) :
 *   chaine        un contrat ;
 *   faux-coffre   un faux coffre en mémoire : aucun fonds, aucune chaîne ;
 *   non-confirme  le proxy ne l'a pas dit, ou sa réponse est illisible ;
 *   lecture       première lecture en cours ;
 *   sans-objet    le relais lui-même est simulé (serveur de fixtures).
 * Seul « chaine » laisse l'étiquette « réel » sur ce qui vient du coffre.
 */
export type VaultOrigin = "chaine" | "faux-coffre" | "non-confirme" | "lecture" | "sans-objet";
/** Étiquette de provenance d'un panneau. */
export type TagSource = Source | "faux-coffre" | "non-confirme";

/** PROPOSÉ, API-NEEDS.md § 7. Référentiel local : un identifiant opaque, un libellé d'affichage. */
export type LibelleGenre = "beneficiaire" | "agent" | "facture" | "placement" | "client";
export type Libelle = {
  id: string;
  genre: LibelleGenre;
  libelle: string;
  detail?: string;
  /** Ligne sous le nom, par exemple « Facture FB-2026-1183 ». */
  sous_titre?: string;
  /** Fournisseurs : IBAN déjà masqué dans le fichier (FR76 •••• 4021). Jamais un IBAN complet. */
  iban_masque?: string;
  /** Fournisseurs : SIREN fictif, « 812 447 905 ». */
  siren?: string;
};
export type Libelles = { version: 1; libelles: Libelle[] };

/** PROPOSÉ, API-NEEDS.md § 8. Unité d'affichage : 1 symbole = 10^decimales wei. */
export type Unite = { symbole: string; decimales: number };
