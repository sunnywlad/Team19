// File d'attente : base temporaire entre l'IA du client et le relais (étape 7).
// C'est un tuyau non fiable par conception : la signature du client protège le
// contenu, et le contrat la revérifie. Les demandes traitées sont purgées.
import { DatabaseSync } from "node:sqlite";
import type { DecisionRequest } from "./request.ts";

export const QUEUE_STATUSES = ["PENDING", "SUBMITTED", "DONE", "EXPIRED"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export type QueuedRequest = {
  request: DecisionRequest;
  status: QueueStatus;
  received_at: number;
  updated_at: number;
};

type Row = { payload: string; status: string; received_at: number; updated_at: number };

function toQueued(row: Row): QueuedRequest {
  return {
    request: JSON.parse(row.payload) as DecisionRequest,
    status: row.status as QueueStatus,
    received_at: row.received_at,
    updated_at: row.updated_at,
  };
}

export class RequestQueue {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS queue (
        request_id  TEXT PRIMARY KEY,
        payload     TEXT NOT NULL,
        expires_at  INTEGER NOT NULL,
        status      TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS queue_status ON queue (status, received_at);
    `);
  }

  // Renvoie false si l'identifiant est déjà connu : une demande rejouée
  // n'entre pas deux fois, même si la première a déjà été traitée.
  enqueue(request: DecisionRequest, nowSeconds: number): boolean {
    const result = this.#db
      .prepare(
        "INSERT OR IGNORE INTO queue (request_id, payload, expires_at, status, received_at, updated_at) VALUES (?, ?, ?, 'PENDING', ?, ?)",
      )
      .run(request.request_id, JSON.stringify(request), request.expires_at, nowSeconds, nowSeconds);
    return result.changes === 1;
  }

  // Prend la plus ancienne demande en attente et non expirée, et la marque
  // SUBMITTED dans la même transaction : deux relais ne prennent jamais la même.
  claimNext(nowSeconds: number): DecisionRequest | null {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#db
        .prepare(
          "SELECT request_id, payload FROM queue WHERE status = 'PENDING' AND expires_at > ? ORDER BY received_at, request_id LIMIT 1",
        )
        .get(nowSeconds) as { request_id: string; payload: string } | undefined;
      if (row !== undefined) {
        this.#db
          .prepare("UPDATE queue SET status = 'SUBMITTED', updated_at = ? WHERE request_id = ?")
          .run(nowSeconds, row.request_id);
      }
      this.#db.exec("COMMIT");
      return row === undefined ? null : (JSON.parse(row.payload) as DecisionRequest);
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  // Le contrat a rendu une décision terminale pour cette demande.
  complete(requestId: string, nowSeconds: number): boolean {
    const result = this.#db
      .prepare("UPDATE queue SET status = 'DONE', updated_at = ? WHERE request_id = ? AND status = 'SUBMITTED'")
      .run(nowSeconds, requestId);
    return result.changes === 1;
  }

  // Les demandes en attente dont le délai est passé deviennent EXPIRED : une
  // demande jamais soumise (relais en panne) n'est jamais autorisée par défaut.
  expire(nowSeconds: number): string[] {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.#db
        .prepare("SELECT request_id FROM queue WHERE status = 'PENDING' AND expires_at <= ? ORDER BY received_at")
        .all(nowSeconds) as { request_id: string }[];
      this.#db
        .prepare("UPDATE queue SET status = 'EXPIRED', updated_at = ? WHERE status = 'PENDING' AND expires_at <= ?")
        .run(nowSeconds, nowSeconds);
      this.#db.exec("COMMIT");
      return rows.map((r) => r.request_id);
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  // Base temporaire : le contenu des demandes terminées est effacé après le
  // délai de rétention. L'identifiant reste, pour continuer à refuser un rejeu.
  purge(nowSeconds: number, retentionSeconds: number): number {
    const result = this.#db
      .prepare(
        "UPDATE queue SET payload = '{}' WHERE status IN ('DONE', 'EXPIRED') AND payload != '{}' AND updated_at <= ?",
      )
      .run(nowSeconds - retentionSeconds);
    return Number(result.changes);
  }

  get(requestId: string): QueuedRequest | null {
    const row = this.#db
      .prepare("SELECT payload, status, received_at, updated_at FROM queue WHERE request_id = ?")
      .get(requestId) as Row | undefined;
    return row === undefined ? null : toQueued(row);
  }

  counts(): Record<QueueStatus, number> {
    const counts: Record<QueueStatus, number> = { PENDING: 0, SUBMITTED: 0, DONE: 0, EXPIRED: 0 };
    const rows = this.#db.prepare("SELECT status, COUNT(*) AS n FROM queue GROUP BY status").all() as {
      status: QueueStatus;
      n: number;
    }[];
    for (const row of rows) counts[row.status] = row.n;
    return counts;
  }

  close(): void {
    this.#db.close();
  }
}
