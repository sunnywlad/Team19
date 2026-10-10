// lib/reasons.ts — table nom -> bit (§ 3), SCRIPT_REASONS, reasonsToMask, maskToReasons

// Table complète des motifs (§ 3 de interface.md)
// Clé : nom, valeur : numéro de bit (0-15)
export const REASON_BITS: Record<string, number> = {
  amount_above_cap:                   0,
  beneficiary_not_allowed:            1,
  reference_unknown:                  2,
  decision_inconsistent_with_prompt:  3,
  insufficient_context:               4,
  suspected_injection:                5,
  duplicate_payment:                  6,
  content_mismatch:                   7,
  evaluator_error:                    8,
  evaluator_timeout:                  9,
  other:                              15,
};

// Motifs que le script d'évaluation peut poser (bits 0-6 + 15)
// Le service pose les bits 7, 8, 9.
export const SCRIPT_REASONS = new Set([
  'amount_above_cap',
  'beneficiary_not_allowed',
  'reference_unknown',
  'decision_inconsistent_with_prompt',
  'insufficient_context',
  'suspected_injection',
  'duplicate_payment',
  'other',
]);

// Motifs posés par le service (jamais par le script)
export const SERVICE_REASONS = new Set([
  'content_mismatch',
  'evaluator_error',
  'evaluator_timeout',
]);

// reasonsToMask : liste de noms → masque uint16
// Lance une erreur si un nom est inconnu.
export function reasonsToMask(names: string[]): number {
  let mask = 0;
  for (const name of names) {
    const bit = REASON_BITS[name];
    if (bit === undefined) throw new Error(`Motif inconnu : ${name}`);
    mask |= (1 << bit);
  }
  return mask;
}

// maskToReasons : masque uint16 → liste de noms connus (dans l'ordre croissant des bits)
export function maskToReasons(mask: number): string[] {
  const bitToName = new Map<number, string>(
    Object.entries(REASON_BITS).map(([name, bit]) => [bit, name]),
  );
  const result: string[] = [];
  for (let bit = 0; bit < 16; bit++) {
    if (mask & (1 << bit)) {
      const name = bitToName.get(bit);
      result.push(name ?? `unknown_bit_${bit}`);
    }
  }
  return result;
}
