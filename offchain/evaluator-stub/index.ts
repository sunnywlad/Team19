/**
 * Évaluateur factice — Team19
 *
 * Lit tout stdin, parse le JSON, évalue amountMinor et rend une ligne JSON sur stdout.
 *
 * Paliers :
 *   amountMinor > 1 000 000 → vote 0, ["amount_above_cap"]
 *   amountMinor >   100 000 → vote 1, ["insufficient_context"]
 *   sinon                   → vote 2, []
 *
 * Variables de test :
 *   STUB_SLEEP_MS — attente en ms avant la réponse (défaut 0)
 *   STUB_EXIT     — code de sortie forcé (remplace le code normal)
 *
 * Code de sortie 1 si le payload est illisible ou JSON invalide.
 * Aucun import en dehors de node:.
 */

import { stdin, stdout, stderr, exit, env } from 'node:process';

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  // 1. Lire stdin
  let raw: Buffer;
  try {
    raw = await readStdin();
  } catch (err) {
    stderr.write(`evaluator-stub: erreur lecture stdin: ${err}\n`);
    exit(1);
  }

  // 2. Parse JSON
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    stderr.write('evaluator-stub: JSON invalide\n');
    exit(1);
  }

  // 3. Extraire amountMinor
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    typeof (payload as Record<string, unknown>).plannedDecision !== 'object' ||
    (payload as Record<string, unknown>).plannedDecision === null
  ) {
    stderr.write('evaluator-stub: payload mal formé (plannedDecision manquant)\n');
    exit(1);
  }

  const decision = (payload as Record<string, unknown>).plannedDecision as Record<string, unknown>;
  const amountStr = decision.amountMinor;

  if (typeof amountStr !== 'string' || !/^(0|[1-9][0-9]*)$/.test(amountStr)) {
    stderr.write('evaluator-stub: amountMinor invalide\n');
    exit(1);
  }

  const amount = BigInt(amountStr);

  // 4. Évaluer les paliers
  let vote: number;
  let reasons: string[];
  let summary: string;

  if (amount > 1_000_000n) {
    vote = 0;
    reasons = ['amount_above_cap'];
    summary = 'Montant supérieur au plafond autorisé (10 000,00).';
  } else if (amount > 100_000n) {
    vote = 1;
    reasons = ['insufficient_context'];
    summary = 'Montant élevé (> 1 000,00), validation humaine recommandée.';
  } else {
    vote = 2;
    reasons = [];
    summary = 'Montant dans les limites acceptables.';
  }

  // 5. Attente optionnelle (STUB_SLEEP_MS)
  const sleepMs = env.STUB_SLEEP_MS ? parseInt(env.STUB_SLEEP_MS, 10) : 0;
  if (sleepMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
  }

  // 6. Écrire la réponse (une seule ligne JSON)
  const line = JSON.stringify({ vote, reasons, summary });
  stdout.write(line + '\n');

  // 7. Code de sortie forcé (STUB_EXIT)
  const stubExit = env.STUB_EXIT !== undefined ? parseInt(env.STUB_EXIT, 10) : 0;
  exit(stubExit);
}

main().catch((err) => {
  stderr.write(`evaluator-stub: erreur inattendue: ${err}\n`);
  exit(1);
});
