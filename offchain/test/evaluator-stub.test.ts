/**
 * Tests de l'évaluateur factice (evaluator-stub/index.ts)
 *
 * Lance le script via spawn, envoie le payload sur stdin, vérifie :
 *   - trois paliers et leurs bornes exactes (100000, 100001, 1000000, 1000001)
 *   - sortie = une seule ligne JSON avec vote / reasons / summary
 *   - reasons dans la liste du script
 *   - JSON invalide → code de sortie 1
 *   - STUB_EXIT : code de sortie forcé, JSON valide quand même
 *   - STUB_SLEEP_MS : délai minimal respecté
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Répertoire offchain/ (le test s'exécute depuis offchain/)
const __dirname = dirname(fileURLToPath(import.meta.url));
const OFFCHAIN_DIR = join(__dirname, '..');
const STUB = join(OFFCHAIN_DIR, 'evaluator-stub', 'index.ts');

// Raisons reconnues par le script
const KNOWN_REASONS = new Set(['amount_above_cap', 'insufficient_context']);

/** Construit un payload minimal valide dont seul amountMinor varie. */
function makePayload(amountMinor: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    requester: '0x' + 'ab'.repeat(20),
    agentId: 'test-agent',
    prompt: 'approve',
    context: {},
    plannedDecision: {
      action: 'transfer',
      amountMinor,
      currency: 'EUR',
      beneficiaryId: 'BENEF1',
      reference: 'ref-001',
    },
    createdAt: 0,
    salt: '0x' + '00'.repeat(32),
  });
}

interface RunResult {
  code: number | null;
  stdout: string;
  durationMs: number;
}

/** Lance le stub, envoie `input` sur stdin, résout quand le processus se termine. */
function run(
  input: string,
  env?: Record<string, string>,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn('node', [STUB], {
      cwd: OFFCHAIN_DIR,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        durationMs: Date.now() - t0,
      });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

/** Parse la sortie stdout : doit être exactement une ligne JSON non vide. */
function parseOutput(stdout: string): { vote: unknown; reasons: unknown; summary: unknown } {
  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, 1, `Attendu exactement 1 ligne JSON, obtenu ${lines.length} : ${JSON.stringify(stdout)}`);
  return JSON.parse(lines[0]);
}

// ─── Paliers ───────────────────────────────────────────────────────────────

test('palier bas : 100000 → vote 2, reasons []', async () => {
  const { code, stdout } = await run(makePayload('100000'));
  assert.equal(code, 0);
  const out = parseOutput(stdout);
  assert.equal(out.vote, 2);
  assert.deepEqual(out.reasons, []);
  assert.equal(typeof out.summary, 'string');
});

test('palier moyen bas : 100001 → vote 1, reasons [insufficient_context]', async () => {
  const { code, stdout } = await run(makePayload('100001'));
  assert.equal(code, 0);
  const out = parseOutput(stdout);
  assert.equal(out.vote, 1);
  assert.ok(Array.isArray(out.reasons));
  for (const r of out.reasons as string[]) {
    assert.ok(KNOWN_REASONS.has(r), `motif inconnu : ${r}`);
  }
  assert.ok((out.reasons as string[]).includes('insufficient_context'));
  assert.equal(typeof out.summary, 'string');
});

test('palier moyen haut : 1000000 → vote 1, reasons [insufficient_context]', async () => {
  const { code, stdout } = await run(makePayload('1000000'));
  assert.equal(code, 0);
  const out = parseOutput(stdout);
  assert.equal(out.vote, 1);
  assert.ok((out.reasons as string[]).includes('insufficient_context'));
});

test('palier haut : 1000001 → vote 0, reasons [amount_above_cap]', async () => {
  const { code, stdout } = await run(makePayload('1000001'));
  assert.equal(code, 0);
  const out = parseOutput(stdout);
  assert.equal(out.vote, 0);
  assert.ok(Array.isArray(out.reasons));
  for (const r of out.reasons as string[]) {
    assert.ok(KNOWN_REASONS.has(r), `motif inconnu : ${r}`);
  }
  assert.ok((out.reasons as string[]).includes('amount_above_cap'));
  assert.equal(typeof out.summary, 'string');
});

// ─── Bornes intermédiaires supplémentaires ─────────────────────────────────

test('borne inférieure intermédiaire : 0 → vote 2', async () => {
  const { code, stdout } = await run(makePayload('0'));
  assert.equal(code, 0);
  const out = parseOutput(stdout);
  assert.equal(out.vote, 2);
});

test('grand montant : 9999999999 → vote 0', async () => {
  const { code, stdout } = await run(makePayload('9999999999'));
  assert.equal(code, 0);
  const out = parseOutput(stdout);
  assert.equal(out.vote, 0);
});

// ─── JSON invalide ─────────────────────────────────────────────────────────

test('JSON invalide → exit 1', async () => {
  const { code } = await run('pas du json');
  assert.equal(code, 1);
});

test('chaîne vide → exit 1', async () => {
  const { code } = await run('');
  assert.equal(code, 1);
});

test('payload sans plannedDecision → exit 1', async () => {
  const { code } = await run(JSON.stringify({ schemaVersion: 1 }));
  assert.equal(code, 1);
});

test('amountMinor invalide (décimal) → exit 1', async () => {
  const { code } = await run(
    JSON.stringify({ plannedDecision: { amountMinor: '1.5' } }),
  );
  assert.equal(code, 1);
});

// ─── STUB_EXIT ──────────────────────────────────────────────────────────────

test('STUB_EXIT=3 : JSON valide sur stdout, exit 3', async () => {
  const { code, stdout } = await run(makePayload('50000'), { STUB_EXIT: '3' });
  assert.equal(code, 3);
  // La réponse JSON est quand même émise
  const out = parseOutput(stdout);
  assert.equal(out.vote, 2);
});

test('STUB_EXIT=0 : comportement normal, exit 0', async () => {
  const { code, stdout } = await run(makePayload('50000'), { STUB_EXIT: '0' });
  assert.equal(code, 0);
  const out = parseOutput(stdout);
  assert.equal(out.vote, 2);
});

// ─── STUB_SLEEP_MS ──────────────────────────────────────────────────────────

test('STUB_SLEEP_MS=150 : durée >= 150 ms', async () => {
  const { code, durationMs } = await run(makePayload('50000'), { STUB_SLEEP_MS: '150' });
  assert.equal(code, 0);
  assert.ok(
    durationMs >= 150,
    `Attendu >= 150 ms, obtenu ${durationMs} ms`,
  );
});
