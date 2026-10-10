// lib/payload.ts — validatePayload(bytes) -> Payload | erreur ; deriveFacts(payload) -> Facts
// deriveFacts uses keccak256 from viem (sync, re-exported from @noble/hashes).

import { keccak256, toBytes } from 'viem';
import type { Hex } from 'viem';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Facts = {
  amount: bigint;
  currency: Hex; // bytes3 : 0x + 6 hex
  beneficiaryId: Hex; // bytes32
  referenceId: Hex; // bytes32
};

export type PlannedDecision = {
  action: string;
  amountMinor: string;
  currency: string;
  beneficiaryId: string;
  reference: string;
};

export type Payload = {
  schemaVersion: number;
  requester: string;
  agentId: string;
  prompt: string;
  context: Record<string, unknown>;
  plannedDecision: PlannedDecision;
  createdAt: number;
  salt: Hex;
};

// ─── Validation (§ 1) ────────────────────────────────────────────────────────

const MAX_UINT256 = (1n << 256n) - 1n;

export function validatePayload(bytes: Buffer): Payload {
  let parsed: unknown;

  // UTF-8 + JSON valides
  try {
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) {
      throw new Error('Octets non UTF-8');
    }
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Payload invalide (JSON/UTF-8) : ${(e as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Payload doit être un objet JSON');
  }

  const p = parsed as Record<string, unknown>;

  // Clés exactes à la racine
  const ROOT_KEYS = new Set([
    'schemaVersion', 'requester', 'agentId', 'prompt',
    'context', 'plannedDecision', 'createdAt', 'salt',
  ]);
  for (const k of Object.keys(p)) {
    if (!ROOT_KEYS.has(k)) throw new Error(`Champ inconnu à la racine : ${k}`);
  }
  for (const k of ROOT_KEYS) {
    if (!(k in p)) throw new Error(`Champ manquant : ${k}`);
  }

  if (p['schemaVersion'] !== 1) {
    throw new Error(`schemaVersion doit être 1, reçu : ${JSON.stringify(p['schemaVersion'])}`);
  }

  if (typeof p['requester'] !== 'string' || !/^0x[0-9a-f]{40}$/.test(p['requester'])) {
    throw new Error('requester : adresse 0x + 40 hex minuscules attendue');
  }

  if (typeof p['agentId'] !== 'string') throw new Error('agentId doit être une chaîne');
  if (typeof p['prompt'] !== 'string') throw new Error('prompt doit être une chaîne');

  if (
    typeof p['context'] !== 'object' || p['context'] === null || Array.isArray(p['context'])
  ) {
    throw new Error('context doit être un objet JSON non nul et non tableau');
  }

  if (
    typeof p['plannedDecision'] !== 'object' || p['plannedDecision'] === null || Array.isArray(p['plannedDecision'])
  ) {
    throw new Error('plannedDecision doit être un objet');
  }

  const pd = p['plannedDecision'] as Record<string, unknown>;
  const PD_KEYS = new Set(['action', 'amountMinor', 'currency', 'beneficiaryId', 'reference']);
  for (const k of Object.keys(pd)) {
    if (!PD_KEYS.has(k)) throw new Error(`Champ inconnu dans plannedDecision : ${k}`);
  }
  for (const k of PD_KEYS) {
    if (!(k in pd)) throw new Error(`Champ manquant dans plannedDecision : ${k}`);
  }

  if (typeof pd['action'] !== 'string') throw new Error('plannedDecision.action doit être une chaîne');

  if (typeof pd['amountMinor'] !== 'string' || !/^(0|[1-9][0-9]*)$/.test(pd['amountMinor'])) {
    throw new Error('plannedDecision.amountMinor : entier en chaîne ^(0|[1-9][0-9]*)$ attendu');
  }
  const amount = BigInt(pd['amountMinor']);
  if (amount > MAX_UINT256) throw new Error('plannedDecision.amountMinor >= 2^256');

  if (typeof pd['currency'] !== 'string' || !/^[A-Z]{3}$/.test(pd['currency'])) {
    throw new Error('plannedDecision.currency : ^[A-Z]{3}$ attendu');
  }

  if (typeof pd['beneficiaryId'] !== 'string' || !/^[A-Z0-9]+$/.test(pd['beneficiaryId'])) {
    throw new Error('plannedDecision.beneficiaryId : ^[A-Z0-9]+$ non vide attendu');
  }

  if (typeof pd['reference'] !== 'string') throw new Error('plannedDecision.reference doit être une chaîne');

  if (
    typeof p['createdAt'] !== 'number' ||
    !Number.isInteger(p['createdAt']) ||
    p['createdAt'] < 0
  ) {
    throw new Error('createdAt : entier >= 0 attendu');
  }

  if (typeof p['salt'] !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(p['salt'])) {
    throw new Error('salt : 0x + 64 hex attendu');
  }

  return {
    schemaVersion: 1,
    requester: p['requester'],
    agentId: p['agentId'],
    prompt: p['prompt'],
    context: p['context'] as Record<string, unknown>,
    plannedDecision: {
      action: pd['action'],
      amountMinor: pd['amountMinor'],
      currency: pd['currency'],
      beneficiaryId: pd['beneficiaryId'],
      reference: pd['reference'],
    },
    createdAt: p['createdAt'],
    salt: p['salt'] as Hex,
  };
}

// ─── deriveFacts (§ 1) ───────────────────────────────────────────────────────

export function deriveFacts(payload: Payload): Facts {
  const pd = payload.plannedDecision;

  // amount : uint256
  const amount = BigInt(pd.amountMinor);

  // currency : bytes3 — 3 ASCII chars → 0x + 6 hex
  const currencyBytes = Buffer.from(pd.currency, 'ascii');
  // currencyBytes has exactly 3 bytes (validated)
  const currencyHex = ('0x' + currencyBytes.toString('hex')) as Hex;

  // beneficiaryId : keccak256(utf8(beneficiaryId))
  const beneficiaryId = keccak256(toBytes(pd.beneficiaryId));

  // referenceId : 0x00…00 si vide, sinon keccak256(utf8(reference))
  const referenceId = pd.reference === ''
    ? ('0x' + '00'.repeat(32)) as Hex
    : keccak256(toBytes(pd.reference));

  return { amount, currency: currencyHex, beneficiaryId, referenceId };
}
