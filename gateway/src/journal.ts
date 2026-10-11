// Ce que la porte attend du service de journal (response/, specs/04), et son
// client HTTP. La porte écrit avant d'agir : si le journal ne répond pas, la
// demande est refusée.
import type { Hex } from "./config.ts";

export type NewJournalEntry = {
  type: string;
  component: "GATEWAY";
  request_id: Hex | null;
  agent_id: Hex | null;
  client_id: Hex | null;
  data: Record<string, unknown>;
};

/** Entrée relue dans le journal : seuls ces champs servent à la porte. */
export type JournalRecord = { seq: number; type: string; agent_id: string | null; data: Record<string, unknown> };

export interface JournalPort {
  append(entry: NewJournalEntry): Promise<void>;
  /** Entrées de rang ≥ fromSeq, dans l'ordre, et nombre total d'entrées du journal. */
  read(fromSeq: number): Promise<{ entries: JournalRecord[]; count: number }>;
}

export class JournalUnavailableError extends Error {
  constructor() {
    super("service de journal injoignable ou en erreur");
    this.name = "JournalUnavailableError";
  }
}

const PAGE = 1000;

export class HttpJournal implements JournalPort {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 2000) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#timeoutMs = timeoutMs;
  }

  async #fetch(path: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch {
      throw new JournalUnavailableError();
    }
    if (!response.ok) throw new JournalUnavailableError();
    return response;
  }

  async append(entry: NewJournalEntry): Promise<void> {
    // Chaque type n'est écrit qu'une fois par demande par la porte : la clé
    // « type:request_id » rend un nouvel essai sans effet.
    await this.#fetch("/journal/entries", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `${entry.type}:${entry.request_id}` },
      body: JSON.stringify(entry),
    });
  }

  async read(fromSeq: number): Promise<{ entries: JournalRecord[]; count: number }> {
    const all: JournalRecord[] = [];
    for (let from = fromSeq; ; ) {
      const response = await this.#fetch(`/journal/entries?from_seq=${from}&limit=${PAGE}`);
      const page = (await response.json()) as { entries: JournalRecord[]; head: { count: number } };
      all.push(...page.entries);
      if (page.entries.length < PAGE) return { entries: all, count: page.head.count };
      from = (page.entries.at(-1) as JournalRecord).seq + 1;
    }
  }
}
