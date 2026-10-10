// Outils de test : journal en mémoire qui valide chaque entrée contre le schéma
// gelé, et validateur des enregistrements de sortie.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import { SPECS_DIR } from "../src/config.ts";
import type { DetectorOutput, Hex } from "../src/config.ts";
import { JournalUnavailableError } from "../src/journal.ts";
import type { JournalPort, JournalRecord, NewJournalEntry } from "../src/journal.ts";

function loadSpecSchema(name: string): ValidateFunction {
  const schema = JSON.parse(readFileSync(join(SPECS_DIR, "schemas", name), "utf8")) as object;
  return new Ajv2020({ strict: true, allErrors: true }).compile(schema);
}

const validateEntry = loadSpecSchema("journal-entry.schema.json");
const validateOutput = loadSpecSchema("detector-output.schema.json");
const HASH = "0".repeat(64);

type Stored = NewJournalEntry | { type: string; component: string; request_id: Hex | null; agent_id: Hex | null; client_id: Hex | null; data: Record<string, unknown> };

// Refuse toute entrée non conforme à specs/04 : un écart de la porte échoue ici
// plutôt qu'à l'intégration avec le vrai service de journal.
export class MemoryJournal implements JournalPort {
  readonly entries: Stored[] = [];
  down = false;

  async append(entry: Stored): Promise<void> {
    if (this.down) throw new JournalUnavailableError();
    const full = { v: 1, seq: this.entries.length, ts_ms: 1_800_000_000_000, ...entry, prev_hash: HASH, hash: HASH };
    if (!validateEntry(full)) {
      throw new TypeError(`entrée non conforme à specs/04 : ${entry.type} ${JSON.stringify(validateEntry.errors?.[0]?.message)}`);
    }
    this.entries.push(entry);
  }

  async entriesFrom(fromSeq: number): Promise<JournalRecord[]> {
    if (this.down) throw new JournalUnavailableError();
    return this.entries.slice(fromSeq).map((e, i) => ({ seq: fromSeq + i, type: e.type, agent_id: e.agent_id, data: e.data }));
  }

  types(requestId?: Hex): string[] {
    return this.entries.filter((e) => requestId === undefined || e.request_id === requestId).map((e) => e.type);
  }

  last(type: string): Stored {
    const found = this.entries.findLast((e) => e.type === type);
    if (found === undefined) throw new Error(`aucune entrée ${type}`);
    return found;
  }
}

/** Schéma gelé, plus les deux règles hors schéma de specs/03 § 4. */
export function assertValidOutput(output: DetectorOutput): void {
  if (!validateOutput(output)) {
    throw new Error(`sortie non conforme à specs/03 : ${JSON.stringify(validateOutput.errors?.[0])}`);
  }
  if (output.score !== null && output.score >= output.threshold && output.verdict !== "BLOCK") {
    throw new Error("règle SCORE_VERDICT : score ≥ seuil sans BLOCK");
  }
  if (output.detected_at_ms < output.received_at_ms) throw new Error("règle : détection avant réception");
}

export function fixtures(): { ids: Record<string, Hex>; agents: { label: string; agent_id: Hex; mandate: string[] }[] } {
  return JSON.parse(readFileSync(join(SPECS_DIR, "examples", "fixtures.json"), "utf8")) as ReturnType<typeof fixtures>;
}
