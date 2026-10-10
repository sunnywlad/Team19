// Journal réel : remet chaque entrée au service de journal de response/
// (specs/04 § 1 : un seul écrivain). Contrat HTTP : response/README.md,
// « Écrire une entrée ». Volontairement sans import de response/ : relay/
// s'installe et se teste seul.
//
// Chaque entrée reçoit sa clé d'idempotence UNE fois, à sa création, et elle
// est écrite avec son corps dans une boîte d'envoi (SQLite) avant le premier
// envoi. Toute nouvelle tentative, y compris après un redémarrage, renvoie le
// même corps sous la même clé. La clé ne dépend pas du contenu : deux entrées
// identiques sont deux entrées.
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { JournalClient, NewJournalEntry } from "./journal.ts";

/** Le service de journal n'a pas pris l'entrée. L'appelant échoue fermé. */
export class JournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalError";
  }
}

export type HttpJournalOptions = {
  /** Fichier de la boîte d'envoi. Par défaut en mémoire : rien ne survit à un arrêt. */
  outboxPath?: string;
  timeoutMs?: number;
  /** Générateur de clé, pour les tests. Par défaut : UUID aléatoire. */
  newKey?: () => string;
};

/** Une entrée en attente de remise, telle qu'elle sera renvoyée. */
export type OutboxRow = { id: number; idempotency_key: string; body: string; type: string; attempts: number };

export class HttpJournal implements JournalClient {
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #newKey: () => string;
  readonly #db: DatabaseSync;
  // Une remise à la fois : l'ordre des entrées est celui de leur création.
  #turn: Promise<unknown> = Promise.resolve();

  constructor(baseUrl: string, options: HttpJournalOptions = {}) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("JOURNAL_URL doit être en http(s)");
    this.#endpoint = `${url.origin}/journal/entries`;
    this.#timeoutMs = options.timeoutMs ?? 2000;
    this.#newKey = options.newKey ?? randomUUID;
    this.#db = new DatabaseSync(options.outboxPath ?? ":memory:");
    this.#db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS journal_outbox (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotency_key TEXT NOT NULL UNIQUE,
        body            TEXT NOT NULL,
        type            TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'PENDING',
        http_status     INTEGER,
        attempts        INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS journal_outbox_status ON journal_outbox (status, id);
    `);
  }

  /**
   * Écrit l'entrée et sa clé dans la boîte d'envoi, puis remet tout ce qui
   * attend, dans l'ordre. Lève JournalError si l'entrée n'a pas été prise :
   * elle reste alors en attente (sauf refus définitif) et repartira sous la
   * même clé.
   */
  append(entry: NewJournalEntry): Promise<void> {
    return this.#exclusive(async () => {
      const { lastInsertRowid } = this.#db
        .prepare("INSERT INTO journal_outbox (idempotency_key, body, type) VALUES (?, ?, ?)")
        .run(this.#newKey(), JSON.stringify(entry), entry.type);
      await this.#deliver(Number(lastInsertRowid));
    });
  }

  /** Remet les entrées en attente. À appeler au démarrage et à chaque tour. */
  flush(): Promise<void> {
    return this.#exclusive(() => this.#deliver(null));
  }

  /** Entrées en attente de remise, de la plus ancienne à la plus récente. */
  pending(): OutboxRow[] {
    return this.#db.prepare("SELECT id, idempotency_key, body, type, attempts FROM journal_outbox WHERE status = 'PENDING' ORDER BY id").all() as OutboxRow[];
  }

  /** Entrées que le service a refusées pour de bon (4xx) : gardées, jamais renvoyées. */
  refused(): (OutboxRow & { http_status: number })[] {
    return this.#db
      .prepare("SELECT id, idempotency_key, body, type, attempts, http_status FROM journal_outbox WHERE status = 'REFUSED' ORDER BY id")
      .all() as (OutboxRow & { http_status: number })[];
  }

  close(): void {
    this.#db.close();
  }

  #exclusive<T>(run: () => Promise<T>): Promise<T> {
    const mine = this.#turn.then(run);
    this.#turn = mine.catch(() => undefined);
    return mine;
  }

  async #deliver(own: number | null): Promise<void> {
    let ownRefusal: { type: string; status: number } | null = null;
    for (const row of this.pending()) {
      this.#db.prepare("UPDATE journal_outbox SET attempts = attempts + 1 WHERE id = ?").run(row.id);
      let status: number;
      try {
        const response = await fetch(this.#endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": row.idempotency_key },
          body: row.body,
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        status = response.status;
      } catch {
        // Pas de détail : le message d'origine peut contenir l'URL.
        throw new JournalError("service de journal injoignable");
      }
      if (status === 200 || status === 201) {
        // 201 : écrite. 200 : déjà écrite sous cette clé, par une tentative restée sans réponse.
        this.#db.prepare("DELETE FROM journal_outbox WHERE id = ?").run(row.id);
      } else if (status >= 400 && status < 500) {
        // Refus définitif : la renvoyer ne changerait rien, et elle ne doit pas bloquer les suivantes.
        this.#db.prepare("UPDATE journal_outbox SET status = 'REFUSED', http_status = ? WHERE id = ?").run(status, row.id);
        if (row.id === own) ownRefusal = { type: row.type, status };
      } else {
        throw new JournalError(`service de journal en erreur (${status})`);
      }
    }
    if (ownRefusal) throw new JournalError(`entrée ${ownRefusal.type} refusée par le service de journal (${ownRefusal.status})`);
  }
}
