// lib/config.ts — lecture des variables d'environnement, erreur claire si manquante
// Les chemins par défaut sont résolus depuis le dossier offchain/ lui-même (import.meta.dirname),
// jamais depuis le répertoire courant. Un chemin relatif passé par variable d'environnement est
// résolu depuis le répertoire courant (comportement standard).

import { resolve } from 'node:path';

// Dossier offchain/ — référence absolue pour tous les chemins par défaut
const OFFCHAIN_DIR = resolve(import.meta.dirname, '..');

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

// Résout un chemin : s'il est fourni par l'env, relatif au cwd ; sinon chemin par défaut absolu.
function resolvedPath(envName: string, defaultRelative: string): string {
  const v = process.env[envName];
  if (v) return resolve(v); // relatif au cwd si fourni par l'env
  return resolve(OFFCHAIN_DIR, defaultRelative);
}

export function getConfig() {
  return {
    rpcUrl: optional('RPC_URL', 'http://127.0.0.1:9654'),
    chainId: BigInt(optional('CHAIN_ID', '191919')),
    marketAddress: required('MARKET_ADDRESS') as `0x${string}`,
    registryAddress: process.env['REGISTRY_ADDRESS'] as `0x${string}` | undefined,
    cacheUrl: optional('CACHE_URL', 'http://127.0.0.1:8701'),
    cachePort: parseInt(optional('CACHE_PORT', '8701'), 10),
    gatewayPort: parseInt(optional('GATEWAY_PORT', '8700'), 10),
    cacheDataDir: resolvedPath('CACHE_DATA_DIR', 'data/cache'),
    cacheWriteToken: process.env['CACHE_WRITE_TOKEN'] ?? '',
    securityAddresses: (process.env['SECURITY_ADDRESSES'] ?? '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean) as `0x${string}`[],
    gatewayApiKeys: (process.env['GATEWAY_API_KEYS'] ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    requesterKey: process.env['REQUESTER_KEY'] as `0x${string}` | undefined,
    verifierKey: process.env['VERIFIER_KEY'] as `0x${string}` | undefined,
    verifierDataDir: process.env['VERIFIER_DATA_DIR']
      ? resolve(process.env['VERIFIER_DATA_DIR'])
      : undefined,
    evaluatorCmd: optional('EVALUATOR_CMD', 'node evaluator-stub/index.ts'),
    evaluatorTimeoutMs: parseInt(optional('EVALUATOR_TIMEOUT_MS', '90000'), 10),
    incidentsLog: resolvedPath('INCIDENTS_LOG', 'incidents.log'),
    pollMs: parseInt(optional('POLL_MS', '1000'), 10),
  };
}

// verifierDataDir : répertoire de données par défaut pour un vérificateur donné.
// Suit le même principe : résolu depuis offchain/ si absent de l'env.
export function verifierDataDir(address: string): string {
  const v = process.env['VERIFIER_DATA_DIR'];
  if (v) return resolve(v);
  return resolve(OFFCHAIN_DIR, `data/verifier-${address.toLowerCase()}`);
}

export type Config = ReturnType<typeof getConfig>;
