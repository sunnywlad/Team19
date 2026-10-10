// Forme canonique et empreinte d'une entrée de journal (specs/04 § 4).
//
//   corps(n) = l'entrée n privée de « hash » et « prev_hash »
//   H(n)     = SHA-256( UTF-8( JCS( corps(n) ) ) ‖ H(n−1) en 32 octets bruts )
//   H(−1)    = 32 octets nuls
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";

export const SPECS_DIR = join(import.meta.dirname, "..", "..", "specs");
export const GENESIS_HASH = "0".repeat(64);

/** Ce qu'un composant remet au service de journal. */
export type NewEntry = {
  type: string;
  component: string;
  request_id: string | null;
  agent_id: string | null;
  client_id: string | null;
  data: Record<string, unknown>;
};

/** Ce que le service écrit : il est seul à attribuer v, seq, ts_ms et les empreintes. */
export type Entry = { v: 1; seq: number; ts_ms: number } & NewEntry & { prev_hash: string; hash: string };

export type Head = { count: number; seq: number | null; hash: string };

// JCS (RFC 8785) réduit au domaine du journal : entiers seulement, donc tri
// des clés et écriture décimale. Aucune normalisation Unicode des chaînes.
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("nombre non entier refusé dans le journal");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("valeur non sérialisable refusée dans le journal");
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(",")}}`;
}

export function entryHash(body: object, prevHash: string): string {
  return createHash("sha256")
    .update(Buffer.from(canonical(body), "utf8"))
    .update(Buffer.from(prevHash, "hex"))
    .digest("hex");
}

/** Empreinte recalculée d'une entrée complète, à comparer à son champ « hash ». */
export function recomputeHash(entry: Entry): string {
  const { hash: _hash, prev_hash: prevHash, ...body } = entry;
  return entryHash(body, prevHash);
}

export function loadSchema(name: string): ValidateFunction {
  const schema = JSON.parse(readFileSync(join(SPECS_DIR, "schemas", name), "utf8")) as object;
  return new Ajv2020({ strict: true, allErrors: true }).compile(schema);
}

let entryValidator: ValidateFunction | undefined;

/** Validateur du schéma gelé specs/schemas/journal-entry.schema.json. */
export function journalEntryValidator(): ValidateFunction {
  entryValidator ??= loadSchema("journal-entry.schema.json");
  return entryValidator;
}

// Ordre d'écriture des champs dans le fichier, celui des exemples de specs/.
// Il n'influence pas l'empreinte, calculée sur la forme canonique.
export function serialize(entry: Entry): string {
  return JSON.stringify({
    v: entry.v,
    seq: entry.seq,
    ts_ms: entry.ts_ms,
    type: entry.type,
    component: entry.component,
    request_id: entry.request_id,
    agent_id: entry.agent_id,
    client_id: entry.client_id,
    data: entry.data,
    prev_hash: entry.prev_hash,
    hash: entry.hash,
  });
}
