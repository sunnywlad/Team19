// verifier/evaluator.ts — lancement du script d'évaluation externe
// Spawn via `sh -c CMD`, payload sur stdin, lecture de la première ligne non vide de stdout.
// Délai : tue le groupe de processus entier.
// Code non nul, JSON invalide, vote hors {0,1,2}, motif inconnu → vote 1, evaluator_error.

import { spawn } from 'node:child_process';
import { REASON_BITS, SCRIPT_REASONS } from '../lib/reasons.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

export type EvaluatorSuccess = {
  ok: true;
  vote: number;       // 0/1/2
  reasons: number;    // masque uint16
  detail: string;     // ligne JSON brute renvoyée par le script
};

export type EvaluatorFailure = {
  ok: false;
  cause: 'evaluator_error' | 'evaluator_timeout';
  detail: string;     // ligne JSON produite par le service
};

export type EvaluatorResult = EvaluatorSuccess | EvaluatorFailure;

// ─── run ─────────────────────────────────────────────────────────────────────

/**
 * Exécute le script d'évaluation.
 *
 * @param cmd          Commande shell (EVALUATOR_CMD), lancée via sh -c
 * @param payloadBytes Octets bruts du payload passés sur stdin
 * @param timeoutMs    Délai maximal en ms (défaut 90 000)
 * @param env          Variables d'environnement supplémentaires (pour les tests)
 */
export async function runEvaluator(
  cmd: string,
  payloadBytes: Buffer,
  timeoutMs: number = 90_000,
  extraEnv?: Record<string, string>,
): Promise<EvaluatorResult> {
  return new Promise(resolve => {
    // Construire un env filtré : retirer toutes les variables sensibles avant
    // de les passer au script tiers (§ 7 : aucune clé ni accès à la chaîne).
    // On garde le strict nécessaire à l'exécution (PATH, HOME, etc.) puis on
    // ajoute les variables de test (STUB_*, NODE_PATH) depuis extraEnv.
    const SAFE_KEYS = new Set([
      'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG',
      'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TEMP', 'TMP',
      'NODE_PATH', 'NODE_OPTIONS',
    ]);
    const SENSITIVE_SUFFIXES = ['_KEY', '_TOKEN', '_SECRET', '_PASSWORD', '_PASS'];
    const SENSITIVE_EXACT = new Set([
      'CACHE_WRITE_TOKEN', 'GATEWAY_API_KEYS', 'DATABASE_URL', 'PRIVATE_KEY',
    ]);

    const filteredEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      const upper = k.toUpperCase();
      const isSensitive =
        SENSITIVE_EXACT.has(upper) ||
        SENSITIVE_SUFFIXES.some(s => upper.endsWith(s));
      if (!isSensitive && (SAFE_KEYS.has(k) || SAFE_KEYS.has(upper))) {
        filteredEnv[k] = v;
      }
    }
    // Fusionner les variables extra (STUB_* de test) par-dessus
    const env = { ...filteredEnv, ...extraEnv };

    // detached: true → le processus est chef de son propre groupe → on peut le tuer entièrement
    const child = spawn('sh', ['-c', cmd], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env,
    });

    let stdout = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      try {
        // Tuer le groupe de processus entier
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      const detail = JSON.stringify({
        ts: new Date().toISOString(),
        cause: 'evaluator_timeout',
        cmd,
      });
      resolve({ ok: false, cause: 'evaluator_timeout', detail });
    }, timeoutMs);

    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stdin!.write(payloadBytes);
    child.stdin!.end();

    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return;

      // Code de sortie non nul
      if (code !== 0) {
        const detail = JSON.stringify({
          ts: new Date().toISOString(),
          cause: 'evaluator_error',
          exitCode: code,
        });
        resolve({ ok: false, cause: 'evaluator_error', detail });
        return;
      }

      // Première ligne non vide
      const line = stdout.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
      if (!line) {
        const detail = JSON.stringify({
          ts: new Date().toISOString(),
          cause: 'evaluator_error',
          reason: 'stdout vide',
        });
        resolve({ ok: false, cause: 'evaluator_error', detail });
        return;
      }

      // Parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        const detail = JSON.stringify({
          ts: new Date().toISOString(),
          cause: 'evaluator_error',
          reason: 'JSON invalide',
          raw: line.slice(0, 200),
        });
        resolve({ ok: false, cause: 'evaluator_error', detail });
        return;
      }

      if (
        typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
      ) {
        const detail = JSON.stringify({
          ts: new Date().toISOString(),
          cause: 'evaluator_error',
          reason: 'réponse non-objet',
        });
        resolve({ ok: false, cause: 'evaluator_error', detail });
        return;
      }

      const r = parsed as Record<string, unknown>;

      // Valider vote
      const vote = r['vote'];
      if (vote !== 0 && vote !== 1 && vote !== 2) {
        const detail = JSON.stringify({
          ts: new Date().toISOString(),
          cause: 'evaluator_error',
          reason: `vote invalide : ${JSON.stringify(vote)}`,
        });
        resolve({ ok: false, cause: 'evaluator_error', detail });
        return;
      }

      // Valider reasons : tableau de chaînes, uniquement motifs posés par le script
      const rawReasons = r['reasons'];
      if (!Array.isArray(rawReasons)) {
        const detail = JSON.stringify({
          ts: new Date().toISOString(),
          cause: 'evaluator_error',
          reason: 'reasons doit être un tableau',
        });
        resolve({ ok: false, cause: 'evaluator_error', detail });
        return;
      }

      let reasonsMask = 0;
      for (const name of rawReasons) {
        if (typeof name !== 'string') {
          const detail = JSON.stringify({
            ts: new Date().toISOString(),
            cause: 'evaluator_error',
            reason: 'motif non-chaîne dans reasons',
          });
          resolve({ ok: false, cause: 'evaluator_error', detail });
          return;
        }
        // Motif inconnu ou réservé au service
        if (!SCRIPT_REASONS.has(name)) {
          const detail = JSON.stringify({
            ts: new Date().toISOString(),
            cause: 'evaluator_error',
            reason: `motif inconnu ou réservé au service : ${name}`,
          });
          resolve({ ok: false, cause: 'evaluator_error', detail });
          return;
        }
        const bit = REASON_BITS[name];
        if (bit !== undefined) reasonsMask |= (1 << bit);
      }

      resolve({
        ok: true,
        vote: vote as number,
        reasons: reasonsMask,
        detail: line,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (killed) return;
      const detail = JSON.stringify({
        ts: new Date().toISOString(),
        cause: 'evaluator_error',
        reason: err.message,
      });
      resolve({ ok: false, cause: 'evaluator_error', detail });
    });
  });
}
