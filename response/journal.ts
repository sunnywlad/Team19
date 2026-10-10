// Journal chaîné par empreinte : chaque entrée contient l'empreinte de la
// précédente, donc toute modification ou suppression casse la chaîne.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

// Étapes du flux. Les numéros suivent le schéma du projet.
export const STEPS = [
  "1_DEMANDE_RECUE",
  "2_TESTS_SECURITE",
  "3_SCHEMA_VALIDE",
  "4_ENVOI_IA_CLIENT",
  "6_DECISION_DEMANDEE",
  "7_FILE_ENTREE",
  "8_SOUMISSION_CONTRAT",
  "9_DECISION_CONTRAT",
  "10_VALIDATION_HUMAINE",
  "11_BASE_DURABLE",
  "QUARANTAINE",
  "PAUSE_AGENT",
  "ALERTE",
  "QUALIFICATION_HUMAINE",
  "ERREUR",
] as const;
export type Step = (typeof STEPS)[number];

export type JournalEntry = {
  seq: number;
  ts: string;
  step: Step;
  actor: string;
  request_id: string | null;
  data: JsonObject;
  prev_hash: string;
  hash: string;
};

export type NewEntry = {
  step: Step;
  actor: string;
  request_id?: string | null;
  data?: JsonObject;
};

export type VerifyResult =
  | { ok: true; count: number; head: string }
  | { ok: false; count: number; seq: number; reason: string };

export const GENESIS_HASH = "0".repeat(64);

// Sérialisation stable : clés triées, pour qu'un même contenu donne
// toujours la même empreinte, quel que soit l'ordre d'insertion.
export function canonicalize(value: Json): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("nombre non fini refusé dans le journal");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k] as Json)}`).join(",")}}`;
}

export function entryHash(entry: Omit<JournalEntry, "hash">): string {
  const body = canonicalize({
    seq: entry.seq,
    ts: entry.ts,
    step: entry.step,
    actor: entry.actor,
    request_id: entry.request_id,
    data: entry.data,
    prev_hash: entry.prev_hash,
  });
  return createHash("sha256").update(body).digest("hex");
}

type Row = {
  seq: number;
  ts: string;
  step: string;
  actor: string;
  request_id: string | null;
  data: string;
  prev_hash: string;
  hash: string;
};

function toEntry(row: Row): JournalEntry {
  return { ...row, step: row.step as Step, data: JSON.parse(row.data) as JsonObject };
}

export class Journal {
  readonly #db: DatabaseSync;
  readonly #now: () => Date;

  constructor(path: string, now: () => Date = () => new Date()) {
    this.#db = new DatabaseSync(path);
    this.#now = now;
    this.#db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS journal (
        seq        INTEGER PRIMARY KEY,
        ts         TEXT NOT NULL,
        step       TEXT NOT NULL,
        actor      TEXT NOT NULL,
        request_id TEXT,
        data       TEXT NOT NULL,
        prev_hash  TEXT NOT NULL,
        hash       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS journal_request ON journal (request_id);
    `);
  }

  append(input: NewEntry): JournalEntry {
    if (!STEPS.includes(input.step)) {
      throw new TypeError(`étape de journal inconnue : ${String(input.step)}`);
    }
    if (input.actor.trim() === "") {
      throw new TypeError("acteur manquant");
    }
    const data = input.data ?? {};
    const dataText = canonicalize(data);

    // BEGIN IMMEDIATE : un seul écrivain à la fois, même entre processus,
    // pour que deux entrées ne prennent jamais le même numéro.
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const last = this.#db
        .prepare("SELECT seq, hash FROM journal ORDER BY seq DESC LIMIT 1")
        .get() as { seq: number; hash: string } | undefined;
      const base: Omit<JournalEntry, "hash"> = {
        seq: (last?.seq ?? 0) + 1,
        ts: this.#now().toISOString(),
        step: input.step,
        actor: input.actor,
        request_id: input.request_id ?? null,
        data: JSON.parse(dataText) as JsonObject,
        prev_hash: last?.hash ?? GENESIS_HASH,
      };
      const entry: JournalEntry = { ...base, hash: entryHash(base) };
      this.#db
        .prepare(
          "INSERT INTO journal (seq, ts, step, actor, request_id, data, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(entry.seq, entry.ts, entry.step, entry.actor, entry.request_id, dataText, entry.prev_hash, entry.hash);
      this.#db.exec("COMMIT");
      return entry;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  entries(requestId?: string): JournalEntry[] {
    const rows = (
      requestId === undefined
        ? this.#db.prepare("SELECT * FROM journal ORDER BY seq").all()
        : this.#db.prepare("SELECT * FROM journal WHERE request_id = ? ORDER BY seq").all(requestId)
    ) as Row[];
    return rows.map(toEntry);
  }

  // Empreinte de la dernière entrée. À conserver hors du journal (rapport,
  // ancrage) : c'est elle qui permet de détecter une troncature en fin de chaîne.
  head(): string {
    const last = this.#db.prepare("SELECT hash FROM journal ORDER BY seq DESC LIMIT 1").get() as
      | { hash: string }
      | undefined;
    return last?.hash ?? GENESIS_HASH;
  }

  // Recalcule toute la chaîne. Avec expectedHead, détecte aussi la suppression
  // des dernières entrées, invisible sans référence extérieure.
  verify(expectedHead?: string): VerifyResult {
    const rows = this.#db.prepare("SELECT * FROM journal ORDER BY seq").all() as Row[];
    let prev = GENESIS_HASH;
    let expectedSeq = 1;
    for (const row of rows) {
      const fail = (reason: string): VerifyResult => ({ ok: false, count: rows.length, seq: row.seq, reason });
      if (row.seq !== expectedSeq) {
        return fail(`numéro attendu ${expectedSeq}, trouvé ${row.seq} : entrée supprimée ou insérée`);
      }
      if (row.prev_hash !== prev) {
        return fail("l'empreinte précédente ne correspond pas");
      }
      let entry: JournalEntry;
      try {
        entry = toEntry(row);
      } catch {
        return fail("données illisibles");
      }
      const { hash: _stored, ...rest } = entry;
      if (entryHash(rest) !== row.hash) {
        return fail("le contenu ne correspond plus à son empreinte");
      }
      prev = row.hash;
      expectedSeq += 1;
    }
    if (expectedHead !== undefined && expectedHead !== prev) {
      return {
        ok: false,
        count: rows.length,
        seq: rows.length,
        reason: "la dernière empreinte ne correspond pas à la référence : journal tronqué ou remplacé",
      };
    }
    return { ok: true, count: rows.length, head: prev };
  }

  close(): void {
    this.#db.close();
  }
}
