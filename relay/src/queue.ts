// File d'attente persistante (SQLite). La file est un tuyau non fiable : elle
// valide ce qui entre, ne modifie jamais une demande et n'autorise rien.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { AlertSink } from "./alerts.ts";
import type { Policy } from "./config.ts";
import type { JournalClient } from "./journal.ts";
import { checkValidityWindow, validateRequestShape, type WindowDefect } from "./schema.ts";
import { toSeconds, type Clock, type Hex, type SignedRequest } from "./types.ts";

export type QueueStatus =
  /** En attente de soumission. */
  | "PENDING"
  /** Soumission en cours : écrit AVANT l'envoi, pour survivre à un arrêt brutal. */
  | "SUBMITTING"
  /** Transaction partie. La décision se lit dans l'index, pas ici. */
  | "SUBMITTED"
  /** Expirée en file sans avoir été soumise. */
  | "EXPIRED"
  /** Écartée par le relais avant envoi. */
  | "REJECTED"
  /** A pu partir, sans certitude : jamais renvoyée automatiquement. */
  | "IN_DOUBT";

export type RejectCause = "SCHEMA_INVALID" | WindowDefect | "AGENT_PAUSED" | "PAYLOAD_ALTERED";

export type EnqueueResult =
  | { status: "accepted"; id: number }
  /** Même demande déjà en file, octet pour octet : aucun effet. */
  | { status: "duplicate"; id: number }
  /** Même request_id, contenu différent : refusée, l'entrée existante ne bouge pas. */
  | { status: "conflict" }
  | { status: "rejected"; cause: "SCHEMA_INVALID" | WindowDefect };

export type QueueRow = {
  id: number;
  request_id: Hex;
  agent_id: Hex;
  client_id: Hex;
  expires_at: number;
  status: QueueStatus;
  enqueued_at_ms: number;
  updated_at_ms: number;
  attempts: number;
  tx_hash: Hex | null;
  cause: string | null;
};

type FullRow = QueueRow & { payload: string; payload_sha256: string; stall_alerted: number };

const COLUMNS = "id, request_id, agent_id, client_id, expires_at, status, enqueued_at_ms, updated_at_ms, attempts, tx_hash, cause";
const BYTES32 = /^0x[0-9a-f]{64}$/;
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export type QueueDeps = { path: string; policy: Policy; clock: Clock; journal: JournalClient; alerts: AlertSink };

export class Queue {
  readonly #db: DatabaseSync;
  readonly #deps: QueueDeps;

  constructor(deps: QueueDeps) {
    this.#deps = deps;
    this.#db = new DatabaseSync(deps.path);
    this.#db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS queue (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id     TEXT NOT NULL,
        agent_id       TEXT NOT NULL,
        client_id      TEXT NOT NULL,
        expires_at     INTEGER NOT NULL,
        payload        TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        status         TEXT NOT NULL,
        enqueued_at_ms INTEGER NOT NULL,
        updated_at_ms  INTEGER NOT NULL,
        attempts       INTEGER NOT NULL DEFAULT 0,
        tx_hash        TEXT,
        cause          TEXT,
        stall_alerted  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS queue_request ON queue (request_id);
      CREATE INDEX IF NOT EXISTS queue_status ON queue (status, id);
    `);
    // Reprise : une soumission interrompue a pu partir. On ne la rejoue pas.
    this.#db
      .prepare("UPDATE queue SET status = 'IN_DOUBT', cause = 'arrêt pendant la soumission', updated_at_ms = ? WHERE status = 'SUBMITTING'")
      .run(deps.clock());
  }

  /**
   * Entrée dans la file. Le texte reçu est conservé tel quel : la file ne
   * reformate ni ne complète jamais une demande.
   */
  async enqueue(raw: string): Promise<EnqueueResult> {
    const { policy, clock, journal } = this.#deps;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const shape = validateRequestShape(parsed);
    if (!shape.ok) {
      const claimed = (parsed as { request_id?: unknown } | undefined)?.request_id;
      await journal.append({
        type: "SCHEMA_REJECTED",
        component: "QUEUE",
        request_id: typeof claimed === "string" && BYTES32.test(claimed) ? (claimed as Hex) : null,
        agent_id: null,
        client_id: null,
        data: { error_count: shape.errorCount },
      });
      return { status: "rejected", cause: "SCHEMA_INVALID" };
    }
    const request = shape.request;
    const defect = checkValidityWindow(request, toSeconds(clock()), policy);
    if (defect) return { status: "rejected", cause: defect };

    const digest = sha256(raw);
    if (policy.queueDedupByRequestId) {
      const existing = this.#db.prepare("SELECT id, payload_sha256 FROM queue WHERE request_id = ? ORDER BY id LIMIT 1").get(request.request_id) as
        | { id: number; payload_sha256: string }
        | undefined;
      if (existing) return existing.payload_sha256 === digest ? { status: "duplicate", id: existing.id } : { status: "conflict" };
    }

    const now = clock();
    const { lastInsertRowid } = this.#db
      .prepare(
        "INSERT INTO queue (request_id, agent_id, client_id, expires_at, payload, payload_sha256, status, enqueued_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)",
      )
      .run(request.request_id, request.agent_id, request.client_id, request.expires_at, raw, digest, now, now);
    const id = Number(lastInsertRowid);
    try {
      await journal.append({
        type: "ENQUEUED",
        component: "QUEUE",
        request_id: request.request_id,
        agent_id: request.agent_id,
        client_id: request.client_id,
        data: { expires_at: request.expires_at },
      });
    } catch (error) {
      // Pas d'entrée de journal, pas d'entrée en file.
      this.#db.prepare("DELETE FROM queue WHERE id = ?").run(id);
      throw error;
    }
    return { status: "accepted", id };
  }

  /**
   * Entretien : alerte de disponibilité pour ce qui attend trop, puis
   * expiration de ce qui n'est plus valable. À appeler à chaque tour.
   */
  async sweep(): Promise<{ stalled: number; expired: number }> {
    const { policy, clock, journal, alerts } = this.#deps;
    const now = clock();

    const stalled = this.#db
      .prepare(`SELECT ${COLUMNS} FROM queue WHERE status = 'PENDING' AND stall_alerted = 0 AND enqueued_at_ms < ? ORDER BY id`)
      .all(now - policy.queueStallAlertS * 1000) as QueueRow[];
    for (const row of stalled) {
      await alerts.availability({
        kind: "QUEUE_STALL",
        request_id: row.request_id,
        agent_id: row.agent_id,
        waited_s: toSeconds(now - row.enqueued_at_ms),
      });
      this.#db.prepare("UPDATE queue SET stall_alerted = 1 WHERE id = ?").run(row.id);
    }

    const expired = this.#db
      .prepare(`SELECT ${COLUMNS} FROM queue WHERE status = 'PENDING' AND expires_at < ? ORDER BY id`)
      .all(toSeconds(now)) as QueueRow[];
    for (const row of expired) {
      this.#set(row.id, "EXPIRED", { cause: "REQUEST_EXPIRED" });
      await journal.append({
        type: "QUEUE_EXPIRED",
        component: "QUEUE",
        request_id: row.request_id,
        agent_id: row.agent_id,
        client_id: row.client_id,
        data: { expires_at: row.expires_at },
      });
    }
    return { stalled: stalled.length, expired: expired.length };
  }

  /** Demandes en attente, de la plus ancienne à la plus récente. */
  pending(): QueueRow[] {
    return this.#db.prepare(`SELECT ${COLUMNS} FROM queue WHERE status = 'PENDING' ORDER BY id`).all() as QueueRow[];
  }

  /**
   * La demande exactement telle qu'elle est entrée. null si le texte stocké ne
   * correspond plus à son empreinte : le relais ne soumet alors rien.
   */
  payload(id: number): { raw: string; request: SignedRequest } | null {
    const row = this.#db.prepare("SELECT payload, payload_sha256 FROM queue WHERE id = ?").get(id) as
      | Pick<FullRow, "payload" | "payload_sha256">
      | undefined;
    if (!row || sha256(row.payload) !== row.payload_sha256) return null;
    const shape = validateRequestShape(JSON.parse(row.payload));
    return shape.ok ? { raw: row.payload, request: shape.request } : null;
  }

  markSubmitting(id: number): void {
    this.#db
      .prepare("UPDATE queue SET status = 'SUBMITTING', attempts = attempts + 1, updated_at_ms = ? WHERE id = ? AND status = 'PENDING'")
      .run(this.#deps.clock(), id);
  }
  markSubmitted(id: number, txHash: Hex): void {
    this.#set(id, "SUBMITTED", { txHash });
  }
  /** Rien n'est parti : la demande reste en attente, jusqu'à son expiration. */
  markNotSent(id: number, cause: string): void {
    this.#set(id, "PENDING", { cause });
  }
  markInDoubt(id: number, cause: string, txHash: Hex | null): void {
    this.#set(id, "IN_DOUBT", { cause, txHash });
  }
  markRejected(id: number, cause: RejectCause): void {
    this.#set(id, "REJECTED", { cause });
  }

  /** Vue en lecture seule, sans le contenu des demandes ni leur signature. */
  list(limit = 200): QueueRow[] {
    return this.#db.prepare(`SELECT ${COLUMNS} FROM queue ORDER BY id DESC LIMIT ?`).all(limit) as QueueRow[];
  }
  byRequestId(requestId: Hex): QueueRow[] {
    return this.#db.prepare(`SELECT ${COLUMNS} FROM queue WHERE request_id = ? ORDER BY id`).all(requestId) as QueueRow[];
  }

  close(): void {
    this.#db.close();
  }

  #set(id: number, status: QueueStatus, extra: { cause?: string; txHash?: Hex | null }): void {
    this.#db
      .prepare("UPDATE queue SET status = ?, cause = ?, tx_hash = COALESCE(?, tx_hash), updated_at_ms = ? WHERE id = ?")
      .run(status, extra.cause ?? null, extra.txHash ?? null, this.#deps.clock(), id);
  }
}
