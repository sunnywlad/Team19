// lib/readAuth.ts — lecture signée pour les endpoints GET du cache (§ 8)
// Message EIP-191 : "team19-cache-read:{chainId}:{requestId}:{h}:{expiry}"

import { verifyMessage } from 'viem';
import type { Hex } from 'viem';

// Constante de préfixe
const PREFIX = 'team19-cache-read';

// Max age autorisé pour expiry (60 secondes)
const MAX_EXPIRY_GAP_S = 60;

// ─── Construction du message texte ───────────────────────────────────────────

export function readMessage(
  chainId: bigint,
  requestId: bigint,
  h: Hex,
  expiry: number,
): string {
  return `${PREFIX}:${chainId}:${requestId}:${h}:${expiry}`;
}

// ─── Signer (côté client) ────────────────────────────────────────────────────

export type SignReadHeaders = {
  'x-address': string;
  'x-expiry': string;
  'x-signature': string;
};

export async function signRead(
  account: { address: Hex; signMessage: (params: { message: string }) => Promise<Hex> },
  chainId: bigint,
  requestId: bigint,
  h: Hex,
): Promise<SignReadHeaders> {
  const expiry = Math.floor(Date.now() / 1000) + 30; // 30 s de validité
  const message = readMessage(chainId, requestId, h, expiry);
  const signature = await account.signMessage({ message });
  return {
    'x-address':   account.address,
    'x-expiry':    String(expiry),
    'x-signature': signature,
  };
}

// ─── Vérifier (côté cache) ───────────────────────────────────────────────────

export type ReadAuthError =
  | { ok: false; code: 401; reason: string }
  | { ok: true; address: Hex };

export async function verifyRead(
  headers: Record<string, string | string[] | undefined>,
  chainId: bigint,
  requestId: bigint,
  h: Hex,
): Promise<ReadAuthError | { ok: true; address: Hex }> {
  const addressRaw   = scalar(headers['x-address']);
  const expiryRaw    = scalar(headers['x-expiry']);
  const signatureRaw = scalar(headers['x-signature']);

  if (!addressRaw || !expiryRaw || !signatureRaw) {
    return { ok: false, code: 401, reason: 'En-têtes x-address / x-expiry / x-signature manquants' };
  }

  const expiry = parseInt(expiryRaw, 10);
  if (isNaN(expiry)) {
    return { ok: false, code: 401, reason: 'x-expiry invalide' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (expiry <= now) {
    return { ok: false, code: 401, reason: 'x-expiry expiré' };
  }
  if (expiry > now + MAX_EXPIRY_GAP_S) {
    return { ok: false, code: 401, reason: 'x-expiry trop loin dans le futur (> 60 s)' };
  }

  const message = readMessage(chainId, requestId, h, expiry);

  let recovered: Hex;
  try {
    const valid = await verifyMessage({
      address: addressRaw as Hex,
      message,
      signature: signatureRaw as Hex,
    });
    if (!valid) {
      return { ok: false, code: 401, reason: 'Signature invalide' };
    }
    recovered = addressRaw.toLowerCase() as Hex;
  } catch {
    return { ok: false, code: 401, reason: 'Signature invalide' };
  }

  return { ok: true, address: recovered };
}

// ─── Utilitaire ──────────────────────────────────────────────────────────────

function scalar(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
