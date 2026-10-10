// lib/cacheClient.ts — client HTTP pour le cache, partagé entre la passerelle et le vérificateur
// Aucun état : chaque fonction prend l'URL en paramètre.

import type { Hex } from 'viem';
import type { Facts } from './payload.ts';
import { signRead } from './readAuth.ts';

// ─── Types ───────────────────────────────────────────────────────────────────

type FactsJson = {
  amount: string;
  currency: string;
  beneficiaryId: string;
  referenceId: string;
};

export type PostContentResult = {
  contentHash: Hex;
  h: Hex;
};

export type GetContentResult = {
  payload: string; // base64
  facts: FactsJson;
};

export type GetDetailResult = {
  details: Array<{ verifier: string; detail: string /* base64 */ }>;
};

// Compte signataire minimal : addresse + signMessage (wallet viem ou privateKeyToAccount)
type Signer = {
  address: Hex;
  signMessage: (params: { message: string }) => Promise<Hex>;
};

// ─── Helpers internes ─────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new CacheClientError(res.status, text);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CacheClientError(res.status, `Réponse non-JSON : ${text}`);
  }
}

export class CacheClientError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CacheClientError';
    this.status = status;
  }
}

// ─── POST /content ────────────────────────────────────────────────────────────

/**
 * postContent : dépose le payload (octets bruts) et les faits au cache.
 * Renvoie { contentHash, h }. Idempotent.
 *
 * @param url          URL de base du cache, ex. "http://127.0.0.1:8701"
 * @param token        Bearer token (CACHE_WRITE_TOKEN)
 * @param payloadBytes Octets bruts du payload (conservés tels quels)
 * @param facts        Faits dérivés du payload
 */
export async function postContent(
  url: string,
  token: string,
  payloadBytes: Buffer,
  facts: Facts,
): Promise<PostContentResult> {
  const body = JSON.stringify({
    payload: payloadBytes.toString('base64'),
    facts: {
      amount:        facts.amount.toString(),
      currency:      facts.currency,
      beneficiaryId: facts.beneficiaryId,
      referenceId:   facts.referenceId,
    },
  });

  return fetchJson<PostContentResult>(`${url}/content`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body,
  });
}

// ─── GET /content/{h} ────────────────────────────────────────────────────────

/**
 * getContent : lit le payload et les faits depuis le cache (lecture signée, § 8).
 *
 * @param url       URL de base du cache
 * @param account   Compte qui signe la lecture (passerelle : requester ; vérificateur : sa clé)
 * @param chainId   Identifiant de la chaîne
 * @param requestId Identifiant de la demande sur la chaîne
 * @param h         Hash H de la demande
 */
export async function getContent(
  url: string,
  account: Signer,
  chainId: bigint,
  requestId: bigint,
  h: Hex,
): Promise<GetContentResult> {
  const headers = await signRead(account, chainId, requestId, h);
  const target = `${url}/content/${h}?requestId=${requestId}`;
  return fetchJson<GetContentResult>(target, { headers });
}

// ─── POST /detail/{requestId} ────────────────────────────────────────────────

/**
 * postDetail : dépose les octets bruts du détail au cache après le reveal.
 *
 * @param url       URL de base du cache
 * @param requestId Identifiant de la demande
 * @param bytes     Octets bruts de la ligne détail
 */
export async function postDetail(
  url: string,
  requestId: bigint,
  bytes: Buffer,
): Promise<void> {
  const res = await fetch(`${url}/detail/${requestId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new CacheClientError(res.status, text);
  }
}

// ─── GET /detail/{requestId} ─────────────────────────────────────────────────

/**
 * getDetail : lit les détails de la demande depuis le cache (lecture signée, § 8).
 * Disponible seulement en statut Contest, pour le requester et la sécurité.
 *
 * @param url       URL de base du cache
 * @param account   Compte qui signe la lecture
 * @param chainId   Identifiant de la chaîne
 * @param requestId Identifiant de la demande
 * @param h         Hash H de la demande (lu sur la chaîne)
 */
export async function getDetail(
  url: string,
  account: Signer,
  chainId: bigint,
  requestId: bigint,
  h: Hex,
): Promise<GetDetailResult> {
  const headers = await signRead(account, chainId, requestId, h);
  return fetchJson<GetDetailResult>(`${url}/detail/${requestId}`, { headers });
}
