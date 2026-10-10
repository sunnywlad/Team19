// Le journal est tenu par un écrivain unique (specs/04 § 1) qui n'est pas ce
// paquet. Ici : l'interface que relay/ appelle, et un bouchon en mémoire à
// remplacer par le service de feat/reponse-journal.
import { createHash } from "node:crypto";
import type { ValidateFunction } from "ajv/dist/2020.js";
import type { ActionName } from "./config.ts";
import { loadSchema } from "./schema.ts";
import type { Clock, Hex } from "./types.ts";

export type ReasonCode = "INSTRUCTION_IN_DATA" | "AUTHORITY_VIOLATION" | "PAYMENT_ANOMALY" | "SCHEMA_INVALID" | "TOKEN_INVALID" | "RATE_LIMITED";

/** Types et données de specs/04 § 3 que relay/ et ses bouchons écrivent. */
export type JournalData = {
  REQUEST_RECEIVED: { received_at_ms: number; document_sha256: string };
  AUTH_REJECTED: {
    received_at_ms: number;
    cause: "TOKEN_MISSING" | "TOKEN_EXPIRED" | "TOKEN_REVOKED" | "TOKEN_UNKNOWN" | "AGENT_MISMATCH";
    claimed_agent_id: Hex | null;
  };
  DETECTION: {
    score: number;
    threshold: number;
    verdict: "PASS" | "BLOCK";
    reason_codes: ReasonCode[];
    received_at_ms: number;
    detected_at_ms: number;
    detector_version: string;
  };
  REQUEST_PARSED: { action: ActionName; ref_id: Hex };
  SCHEMA_REJECTED: { error_count: number };
  FORWARDED_TO_CLIENT_AI: Record<string, never>;
  REQUEST_SIGNED: { action: ActionName; ref_id: Hex; issued_at: number; expires_at: number; signer: Hex; request_digest: Hex };
  ENQUEUED: { expires_at: number };
  SUBMITTED: { tx_hash: Hex };
  QUEUE_EXPIRED: { expires_at: number };
};
export type JournalType = keyof JournalData;
export type Component = "GATEWAY" | "CLIENT_AI" | "QUEUE" | "RELAY";

export type NewJournalEntry<T extends JournalType = JournalType> = {
  [K in T]: {
    type: K;
    component: Component;
    request_id: Hex | null;
    agent_id: Hex | null;
    client_id: Hex | null;
    data: JournalData[K];
  };
}[T];

export type JournalEntry = NewJournalEntry & { v: 1; seq: number; ts_ms: number; prev_hash: string; hash: string };

/** Ce que relay/ attend du service de journal : lui remettre une entrée. */
export interface JournalClient {
  append(entry: NewJournalEntry): Promise<void>;
}

const GENESIS = "0".repeat(64);

// JCS (RFC 8785) réduit au domaine du journal : entiers seulement (specs/04 § 4).
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("nombre non entier refusé dans le journal");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

/** specs/04 § 4 : H(n) = SHA-256( JCS(corps) ‖ H(n−1) en octets bruts ). */
export function entryHash(body: object, prevHash: string): string {
  return createHash("sha256")
    .update(Buffer.from(canonical(body), "utf8"))
    .update(Buffer.from(prevHash, "hex"))
    .digest("hex");
}

/**
 * Bouchon : garde les entrées en mémoire, les chaîne et les valide contre le
 * schéma gelé, pour qu'une entrée non conforme échoue ici plutôt qu'à
 * l'intégration. Rien n'est persistant.
 */
export class MemoryJournal implements JournalClient {
  readonly entries: JournalEntry[] = [];
  readonly #clock: Clock;
  #validate: ValidateFunction | undefined;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  async append(entry: NewJournalEntry): Promise<void> {
    const prev = this.entries.at(-1)?.hash ?? GENESIS;
    const body = { v: 1 as const, seq: this.entries.length, ts_ms: this.#clock(), ...entry };
    const hash = entryHash(body, prev);
    const full = { ...body, prev_hash: prev, hash } as JournalEntry;
    this.#validate ??= loadSchema("journal-entry.schema.json");
    if (!this.#validate(full)) {
      throw new TypeError(`entrée de journal non conforme à specs/04 : ${entry.type}`);
    }
    this.entries.push(full);
  }

  types(requestId?: Hex): JournalType[] {
    return this.entries.filter((e) => requestId === undefined || e.request_id === requestId).map((e) => e.type);
  }
}
