// Service de journal : écrivain unique du fichier chaîné (specs/04 § 1).
// Lui seul attribue v, seq, ts_ms, prev_hash et hash. Les autres composants
// lui remettent type, component, les trois identifiants et data.
//
// Stockage : un fichier, une entrée JSON par ligne, dans l'ordre de seq.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { GENESIS_HASH, canonical, entryHash, journalEntryValidator, serialize } from "./chain.ts";
import type { Entry, Head, NewEntry } from "./chain.ts";
import { splitLines, verifyJournalText } from "./verify.ts";

export type JournalErrorCode = "INVALID_ENTRY" | "IDEMPOTENCY_CONFLICT" | "CORRUPT" | "LOCKED";

export class JournalError extends Error {
  readonly code: JournalErrorCode;
  readonly errorCount: number;

  constructor(code: JournalErrorCode, message: string, errorCount = 0) {
    super(message);
    this.name = "JournalError";
    this.code = code;
    this.errorCount = errorCount;
  }
}

export type AppendResult = { seq: number; hash: string; duplicate: boolean };
export type EntryFilter = { requestId?: string; fromSeq?: number; limit?: number };
export type Clock = () => number;

const NEW_ENTRY_KEYS = ["type", "component", "request_id", "agent_id", "client_id", "data"];
const MAX_KEY_LENGTH = 200;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM : le processus existe mais ne nous appartient pas.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class JournalStore {
  readonly #path: string;
  readonly #lockPath: string;
  readonly #keysPath: string;
  readonly #clock: Clock;
  readonly #entries: Entry[];
  // Clé d'idempotence -> rang et contenu remis, pour reconnaître une répétition.
  readonly #keys = new Map<string, { seq: number; body: string }>();
  readonly #listeners: ((entry: Entry) => void)[] = [];
  #fd: number;
  #keysFd: number;
  #closed = false;

  private constructor(path: string, clock: Clock, entries: Entry[]) {
    this.#path = path;
    this.#lockPath = `${path}.lock`;
    this.#keysPath = `${path}.keys`;
    this.#clock = clock;
    this.#entries = entries;
    this.#fd = openSync(path, "a");
    this.#keysFd = openSync(this.#keysPath, "a");
  }

  // Ouvre le journal en écriture. Refuse de continuer une chaîne rompue :
  // ajouter derrière une altération la rendrait plus difficile à voir.
  static open(path: string, clock: Clock = Date.now): JournalStore {
    mkdirSync(dirname(path), { recursive: true });
    const lockPath = `${path}.lock`;
    JournalStore.#acquireLock(lockPath);
    try {
      const text = existsSync(path) ? readFileSync(path, "utf8") : "";
      const check = verifyJournalText(text);
      if (check.code !== 0) {
        throw new JournalError("CORRUPT", `journal existant invalide : entrée ${check.at}, ${check.defect}`);
      }
      const store = new JournalStore(path, clock, check.entries);
      store.#loadKeys();
      return store;
    } catch (error) {
      unlinkSync(lockPath);
      throw error;
    }
  }

  // Un seul écrivain : une chaîne d'empreintes impose un ordre total.
  static #acquireLock(lockPath: string): void {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const owner = Number(readFileSync(lockPath, "utf8"));
    if (Number.isInteger(owner) && owner > 0 && owner !== process.pid && isProcessAlive(owner)) {
      throw new JournalError("LOCKED", "un autre service de journal écrit déjà dans ce fichier");
    }
    // Verrou laissé par un processus arrêté (ou par nous-mêmes) : on le reprend.
    const fd = openSync(lockPath, "w");
    writeSync(fd, String(process.pid));
    closeSync(fd);
  }

  #loadKeys(): void {
    if (!existsSync(this.#keysPath)) return;
    for (const line of splitLines(readFileSync(this.#keysPath, "utf8"))) {
      try {
        const { key, seq } = JSON.parse(line) as { key: string; seq: number };
        const entry = this.#entries[seq];
        if (typeof key === "string" && entry !== undefined) {
          this.#keys.set(key, { seq, body: JournalStore.#bodyOf(entry) });
        }
      } catch {
        // Ligne illisible : la clé est perdue, pas le journal. Le pire cas est
        // une entrée écrite deux fois, visible et sans effet sur la chaîne.
      }
    }
  }

  static #bodyOf(entry: NewEntry): string {
    return canonical({
      type: entry.type,
      component: entry.component,
      request_id: entry.request_id,
      agent_id: entry.agent_id,
      client_id: entry.client_id,
      data: entry.data,
    });
  }

  // Ajoute une entrée. Avec une clé d'idempotence, remettre deux fois la même
  // entrée ne l'écrit qu'une fois ; la même clé avec un autre contenu est refusée.
  append(candidate: unknown, idempotencyKey?: string): AppendResult {
    if (this.#closed) throw new Error("journal fermé");
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new JournalError("INVALID_ENTRY", "entrée non conforme à specs/04", 1);
    }
    const input = candidate as Record<string, unknown>;
    // Un appelant ne fixe ni le rang, ni l'heure, ni les empreintes.
    const extra = Object.keys(input).filter((key) => !NEW_ENTRY_KEYS.includes(key));
    if (extra.length > 0) {
      throw new JournalError("INVALID_ENTRY", "entrée non conforme à specs/04", extra.length);
    }

    const prev = this.#entries.at(-1)?.hash ?? GENESIS_HASH;
    const body = {
      v: 1 as const,
      seq: this.#entries.length,
      ts_ms: this.#clock(),
      type: input["type"],
      component: input["component"],
      request_id: input["request_id"],
      agent_id: input["agent_id"],
      client_id: input["client_id"],
      data: input["data"],
    };
    let hash: string;
    try {
      hash = entryHash(body, prev);
    } catch {
      throw new JournalError("INVALID_ENTRY", "entrée non conforme à specs/04", 1);
    }
    const full = { ...body, prev_hash: prev, hash };
    const validate = journalEntryValidator();
    if (!validate(full)) {
      // On ne renvoie que le nombre de défauts, jamais le contenu reçu.
      throw new JournalError("INVALID_ENTRY", "entrée non conforme à specs/04", validate.errors?.length ?? 1);
    }
    const entry = full as Entry;

    if (idempotencyKey !== undefined) {
      if (idempotencyKey === "" || idempotencyKey.length > MAX_KEY_LENGTH) {
        throw new JournalError("INVALID_ENTRY", "clé d'idempotence vide ou trop longue", 1);
      }
      const known = this.#keys.get(idempotencyKey);
      if (known !== undefined) {
        if (known.body !== JournalStore.#bodyOf(entry)) {
          throw new JournalError("IDEMPOTENCY_CONFLICT", "clé d'idempotence déjà utilisée pour une autre entrée");
        }
        return { seq: known.seq, hash: (this.#entries[known.seq] as Entry).hash, duplicate: true };
      }
    }

    // L'entrée est sur le disque avant d'être annoncée comme écrite.
    writeSync(this.#fd, `${serialize(entry)}\n`);
    fsyncSync(this.#fd);
    this.#entries.push(entry);
    if (idempotencyKey !== undefined) {
      const keyLine = JSON.stringify({ key: idempotencyKey, seq: entry.seq });
      writeSync(this.#keysFd, keyLine + "\n");
      fsyncSync(this.#keysFd);
      this.#keys.set(idempotencyKey, { seq: entry.seq, body: JournalStore.#bodyOf(entry) });
    }
    // Les abonnés voient l'entrée une fois écrite. Une erreur d'abonné ne
    // remet pas en cause l'écriture, déjà sur le disque.
    for (const listener of this.#listeners) {
      try {
        listener(entry);
      } catch (error) {
        console.error("journal : erreur d'un abonné", error instanceof Error ? error.message : "");
      }
    }
    return { seq: entry.seq, hash: entry.hash, duplicate: false };
  }

  /** Appelle listener après chaque nouvelle entrée écrite (pas pour une répétition). */
  subscribe(listener: (entry: Entry) => void): void {
    this.#listeners.push(listener);
  }

  /** Empreinte de tête : avec seq, elle résume tout le journal. À conserver hors du journal. */
  head(): Head {
    const last = this.#entries.at(-1);
    return { count: this.#entries.length, seq: last?.seq ?? null, hash: last?.hash ?? GENESIS_HASH };
  }

  entries(filter: EntryFilter = {}): Entry[] {
    const from = filter.fromSeq ?? 0;
    const selected = this.#entries.filter(
      (e) => e.seq >= from && (filter.requestId === undefined || e.request_id === filter.requestId),
    );
    return filter.limit === undefined ? selected : selected.slice(0, filter.limit);
  }

  // Mode démo uniquement : archive le journal et repart d'une chaîne neuve.
  // Rien n'est effacé : le fichier est renommé, et sa tête est écrite à côté,
  // pour pouvoir encore le vérifier avec --expect-head.
  archive(stamp: string): { archive: string; head: Head } {
    if (this.#closed) throw new Error("journal fermé");
    const head = this.head();
    closeSync(this.#fd);
    closeSync(this.#keysFd);
    const archive = `${this.#path}.${stamp}.bak`;
    renameSync(this.#path, archive);
    if (existsSync(this.#keysPath)) renameSync(this.#keysPath, `${archive}.keys`);
    writeFileSync(`${archive}.head.json`, JSON.stringify(head), "utf8");
    this.#entries.length = 0;
    this.#keys.clear();
    this.#fd = openSync(this.#path, "a");
    this.#keysFd = openSync(this.#keysPath, "a");
    return { archive, head };
  }

  get path(): string {
    return this.#path;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    closeSync(this.#fd);
    closeSync(this.#keysFd);
    try {
      unlinkSync(this.#lockPath);
    } catch {
      // déjà retiré
    }
  }
}
