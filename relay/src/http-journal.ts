// Journal réel : remet chaque entrée au service de journal de response/
// (specs/04 § 1 : un seul écrivain). Contrat HTTP : response/README.md,
// « Écrire une entrée ». Volontairement sans import de response/ : relay/
// s'installe et se teste seul.
import { createHash } from "node:crypto";
import type { JournalClient, NewJournalEntry } from "./journal.ts";

/** Le service de journal n'a pas pris l'entrée. L'appelant échoue fermé. */
export class JournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalError";
  }
}

/**
 * Clé d'idempotence : type, demande et empreinte des données. Remettre deux
 * fois la même entrée (reprise après un arrêt) n'en écrit qu'une ; deux
 * entrées du même type aux données différentes (deux soumissions) sont
 * distinctes.
 */
export function idempotencyKey(entry: NewJournalEntry): string {
  const data = createHash("sha256").update(JSON.stringify(entry.data), "utf8").digest("hex").slice(0, 24);
  return `${entry.type}:${entry.request_id ?? "-"}:${data}`;
}

export class HttpJournal implements JournalClient {
  readonly #endpoint: string;
  readonly #timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 2000) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("JOURNAL_URL doit être en http(s)");
    this.#endpoint = `${url.origin}/journal/entries`;
    this.#timeoutMs = timeoutMs;
  }

  async append(entry: NewJournalEntry): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.#endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey(entry) },
        body: JSON.stringify(entry),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      // Pas de détail : le message d'origine peut contenir l'URL.
      throw new JournalError("service de journal injoignable");
    }
    // 201 : écrite. 200 : déjà écrite avec cette clé. Tout le reste est un refus.
    if (response.status !== 200 && response.status !== 201) {
      throw new JournalError(`entrée ${entry.type} refusée par le service de journal (${response.status})`);
    }
  }
}
