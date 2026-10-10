// Indexeur : copie les événements du coffre dans une base durable. Il ne
// décide de rien : si la base tombe, aucune décision n'est faussée.
import { DatabaseSync } from "node:sqlite";
import { REASON, effectiveDecision, reasonName } from "./config.ts";
import type { Hex } from "./types.ts";
import type { EventArgs, VaultClient } from "./vault.ts";

export type IndexerDeps = {
  path: string;
  vault: VaultClient;
  /** Premier bloc à lire, à la première exécution seulement. */
  startBlock: bigint;
  /** Blocs à attendre au-dessus d'un événement avant de l'écrire. */
  confirmations: number;
  /** Nombre maximal de blocs lus par tour. */
  batchSize?: number;
};

export type IndexedEvent = {
  id: number;
  name: string;
  tx_hash: Hex;
  log_index: number;
  block_number: number;
  /** Horodatage du bloc, en secondes : c'est l'heure d'une décision. */
  block_timestamp: number;
  request_id: Hex | null;
  args: EventArgs;
};

export type IndexedDecision = {
  id: number;
  request_id: Hex;
  agent_id: Hex;
  client_id: Hex;
  action: number;
  decision: number;
  reason: number;
  /** null pour un code hors de la liste fermée. */
  reason_name: string | null;
  /** Décision à retenir : 0 dès que le motif est inconnu (specs/02 § 7). */
  effective_decision: number;
  ref_id: Hex;
  tx_hash: Hex;
  log_index: number;
  block_number: number;
  block_timestamp: number;
};

type Row = Omit<IndexedEvent, "args"> & { args: string };

function toEvent(row: Row): IndexedEvent {
  return { ...row, args: JSON.parse(row.args) as EventArgs };
}

function toDecision(e: IndexedEvent): IndexedDecision {
  const a = e.args;
  const decision = Number(a.decision);
  const reason = Number(a.reason);
  return {
    id: e.id,
    request_id: a.requestId as Hex,
    agent_id: a.agentId as Hex,
    client_id: a.clientId as Hex,
    action: Number(a.action),
    decision,
    reason,
    reason_name: reasonName(reason),
    effective_decision: effectiveDecision(decision, reason),
    ref_id: a.refId as Hex,
    tx_hash: e.tx_hash,
    log_index: e.log_index,
    block_number: e.block_number,
    block_timestamp: e.block_timestamp,
  };
}

export class Indexer {
  readonly #db: DatabaseSync;
  readonly #deps: IndexerDeps;

  constructor(deps: IndexerDeps) {
    this.#deps = deps;
    this.#db = new DatabaseSync(deps.path);
    this.#db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT NOT NULL,
        tx_hash         TEXT NOT NULL,
        log_index       INTEGER NOT NULL,
        block_number    INTEGER NOT NULL,
        block_timestamp INTEGER NOT NULL,
        request_id      TEXT,
        args            TEXT NOT NULL,
        UNIQUE (tx_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS events_request ON events (request_id, block_number, log_index);
      CREATE INDEX IF NOT EXISTS events_name ON events (name, id);
    `);
    this.#db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('next_block', ?)").run(deps.startBlock.toString());
  }

  /** Prochain bloc à lire. Persistant : c'est le point de reprise. */
  nextBlock(): bigint {
    const row = this.#db.prepare("SELECT value FROM meta WHERE key = 'next_block'").get() as { value: string };
    return BigInt(row.value);
  }

  /**
   * Un tour : lit les blocs confirmés depuis le point de reprise. L'écriture
   * des événements et l'avancée du point de reprise sont une seule transaction.
   */
  async tick(): Promise<{ inserted: number; nextBlock: bigint }> {
    const { vault, confirmations, batchSize = 500 } = this.#deps;
    const from = this.nextBlock();
    const safe = (await vault.blockNumber()) - BigInt(confirmations);
    if (safe < from) return { inserted: 0, nextBlock: from };
    const to = safe < from + BigInt(batchSize) - 1n ? safe : from + BigInt(batchSize) - 1n;
    const events = await vault.events(from, to);

    let inserted = 0;
    const insert = this.#db.prepare(
      "INSERT OR IGNORE INTO events (name, tx_hash, log_index, block_number, block_timestamp, request_id, args) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const e of events) {
        const requestId = typeof e.args.requestId === "string" ? e.args.requestId : null;
        const result = insert.run(e.name, e.txHash, e.logIndex, Number(e.blockNumber), e.blockTimestamp, requestId, JSON.stringify(e.args));
        inserted += Number(result.changes);
      }
      this.#db.prepare("UPDATE meta SET value = ? WHERE key = 'next_block'").run((to + 1n).toString());
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return { inserted, nextBlock: to + 1n };
  }

  // --- Lecture ---------------------------------------------------------------

  count(): number {
    return (this.#db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  }

  events(filter: { sinceId?: number; name?: string; limit?: number } = {}): IndexedEvent[] {
    const rows = this.#db
      .prepare("SELECT * FROM events WHERE id > ? AND (? IS NULL OR name = ?) ORDER BY id LIMIT ?")
      .all(filter.sinceId ?? 0, filter.name ?? null, filter.name ?? null, filter.limit ?? 200) as Row[];
    return rows.map(toEvent);
  }

  decisions(filter: { requestId?: Hex; sinceId?: number; limit?: number } = {}): IndexedDecision[] {
    const rows = this.#db
      .prepare("SELECT * FROM events WHERE name = 'Decision' AND id > ? AND (? IS NULL OR request_id = ?) ORDER BY id LIMIT ?")
      .all(filter.sinceId ?? 0, filter.requestId ?? null, filter.requestId ?? null, filter.limit ?? 200) as Row[];
    return rows.map((row) => toDecision(toEvent(row)));
  }

  /**
   * Décision courante d'une demande : son dernier événement Decision dont le
   * motif n'est ni REQUEST_REPLAYED ni SIGNATURE_INVALID. specs/02 § 8 dit
   * « celle du dernier », mais ces deux refus peuvent être émis sous le
   * request_id d'une demande déjà décidée, sans toucher à son état : le premier
   * juge une tentative de rejeu, le second une soumission non authentifiée.
   * Pris à la lettre, ils effaceraient un cas 1 en attente. Une clôture de
   * cas 1 (APPROVED, APPROVAL_REFUSED, APPROVAL_TIMEOUT) reste le dernier
   * événement retenu. Si l'index n'a que des événements ignorés pour la
   * demande, c'est le dernier d'entre eux. Règle dérivée, côté relais
   * seulement : voir README, « Décision courante ».
   */
  currentDecision(requestId: Hex): IndexedDecision | null {
    const row = this.#db
      .prepare(
        `SELECT * FROM events WHERE name = 'Decision' AND request_id = ?
         ORDER BY (CAST(json_extract(args, '$.reason') AS INTEGER) IN (?, ?)), block_number DESC, log_index DESC LIMIT 1`,
      )
      .get(requestId, REASON.REQUEST_REPLAYED, REASON.SIGNATURE_INVALID) as Row | undefined;
    return row ? toDecision(toEvent(row)) : null;
  }

  close(): void {
    this.#db.close();
  }
}
