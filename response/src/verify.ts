// Vérification d'un journal (specs/04 § 5). Comportement gelé : mêmes
// contrôles, même ordre, mêmes codes de sortie que la spec.
import { GENESIS_HASH, journalEntryValidator, recomputeHash } from "./chain.ts";
import type { Entry } from "./chain.ts";

export type Defect = "FORMAT" | "SEQ_MISMATCH" | "PREV_MISMATCH" | "HASH_MISMATCH" | "HEAD_MISMATCH";

export type VerifyOptions = { expectHead?: string; expectSeq?: number };

export type VerifyResult =
  | { code: 0; count: number; headSeq: number | null; headHash: string; entries: Entry[] }
  | { code: 1 | 2 | 3; defect: Defect; at: number; count: number; headSeq: number | null; headHash: string };

const EXIT_CODES: Record<Defect, 1 | 2 | 3> = {
  SEQ_MISMATCH: 1,
  PREV_MISMATCH: 1,
  HASH_MISMATCH: 1,
  FORMAT: 2,
  HEAD_MISMATCH: 3,
};

/** Découpe le fichier en lignes. Une seule fin de ligne finale est admise. */
export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// Pour chaque ligne, dans l'ordre, arrêt au premier défaut :
//   1. JSON conforme au schéma            FORMAT
//   2. seq égale le rang de la ligne      SEQ_MISMATCH
//   3. prev_hash égale le hash précédent  PREV_MISMATCH
//   4. hash égale l'empreinte recalculée  HASH_MISMATCH
// Puis, si demandé, la tête attendue :    HEAD_MISMATCH
export function verifyJournalText(text: string, options: VerifyOptions = {}): VerifyResult {
  const validate = journalEntryValidator();
  const entries: Entry[] = [];
  let prev = GENESIS_HASH;

  const fail = (defect: Defect, at: number): VerifyResult => ({
    code: EXIT_CODES[defect],
    defect,
    at,
    count: entries.length,
    headSeq: entries.length === 0 ? null : entries.length - 1,
    headHash: prev,
  });

  const lines = splitLines(text);
  for (let rank = 0; rank < lines.length; rank += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[rank] as string);
    } catch {
      return fail("FORMAT", rank);
    }
    if (!validate(parsed)) return fail("FORMAT", rank);
    const entry = parsed as Entry;
    if (entry.seq !== rank) return fail("SEQ_MISMATCH", rank);
    if (entry.prev_hash !== prev) return fail("PREV_MISMATCH", rank);
    if (recomputeHash(entry) !== entry.hash) return fail("HASH_MISMATCH", rank);
    entries.push(entry);
    prev = entry.hash;
  }

  const headSeq = entries.length === 0 ? null : entries.length - 1;
  const headDiffers =
    (options.expectHead !== undefined && options.expectHead !== prev) ||
    (options.expectSeq !== undefined && options.expectSeq !== headSeq);
  if (headDiffers) return fail("HEAD_MISMATCH", Math.max(entries.length - 1, 0));

  return { code: 0, count: entries.length, headSeq, headHash: prev, entries };
}
