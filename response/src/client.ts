// Client HTTP du service de journal, pour les autres composants. Sa méthode
// append() a la forme attendue par relay/ (interface JournalClient).
import type { Entry, Head, NewEntry } from "./chain.ts";

export type AppendOptions = {
  // Clé d'idempotence. Par défaut « type:request_id », qui suffit pour un type
  // écrit une seule fois par demande. Un type qui se répète pour une même
  // demande (DECISION_OBSERVED, AGENT_PAUSED, ALERT_SENT, SCHEMA_REJECTED,
  // INCIDENT_REPORT_GENERATED) doit fournir la sienne.
  key?: string;
};

export class JournalUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalUnavailableError";
  }
}

export class JournalRejectedError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`entrée refusée par le service de journal (${status})`);
    this.name = "JournalRejectedError";
    this.status = status;
  }
}

export class HttpJournalClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 2000) {
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#timeoutMs = timeoutMs;
  }

  async #fetch(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.#baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(this.#timeoutMs) });
    } catch {
      throw new JournalUnavailableError("service de journal injoignable");
    }
  }

  async append(entry: NewEntry, options: AppendOptions = {}): Promise<void> {
    const key = options.key ?? (entry.request_id === null ? undefined : `${entry.type}:${entry.request_id}`);
    const response = await this.#fetch("/journal/entries", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key === undefined ? {} : { "idempotency-key": key }) },
      body: JSON.stringify(entry),
    });
    if (response.status >= 500) throw new JournalUnavailableError("service de journal en erreur");
    if (!response.ok) throw new JournalRejectedError(response.status);
  }

  // À appeler juste avant une action : pas de réponse, pas d'action.
  async head(): Promise<Head> {
    const response = await this.#fetch("/journal/head");
    if (!response.ok) throw new JournalUnavailableError("service de journal en erreur");
    return (await response.json()) as Head;
  }

  async entries(requestId?: string, fromSeq = 0): Promise<Entry[]> {
    const query = new URLSearchParams({ from_seq: String(fromSeq) });
    if (requestId !== undefined) query.set("request_id", requestId);
    const response = await this.#fetch(`/journal/entries?${query.toString()}`);
    if (!response.ok) throw new JournalUnavailableError("service de journal en erreur");
    return ((await response.json()) as { entries: Entry[] }).entries;
  }
}
