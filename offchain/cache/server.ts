// cache/server.ts — serveur de cache (port 8701 par défaut)
// Exporte startCache(opts) → { server, stop } pour les tests.
// Se lance seul quand exécuté directement.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { Hex } from 'viem';
import { keccak256 } from 'viem';

import { getConfig } from '../lib/config.ts';
import { validatePayload, deriveFacts } from '../lib/payload.ts';
import { contentHashOf, hashOf } from '../lib/hash.ts';
import { readBody, readJsonBody, replyJson, handleError, checkBearer, HttpError } from '../lib/http.ts';
import { verifyRead } from '../lib/readAuth.ts';
import { marketAbi } from '../abi/market.ts';
import { publicClient } from '../lib/chain.ts';

// ─── Types internes ───────────────────────────────────────────────────────────

type FactsJson = {
  amount: string;      // bigint en chaîne décimale
  currency: string;   // 0x + 6 hex
  beneficiaryId: string;
  referenceId: string;
};

type CacheStartOpts = {
  port?: number;
  host?: string;
  dataDir?: string;
  writeToken?: string;
  securityAddresses?: string[];
  rpcUrl?: string;
  chainId?: number;
  marketAddress?: `0x${string}`;
};

// ─── Helpers disque ───────────────────────────────────────────────────────────

function atomicWrite(path: string, data: Buffer | string): void {
  const tmp = path + '.' + randomBytes(6).toString('hex') + '.tmp';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function factsToJson(facts: ReturnType<typeof deriveFacts>): FactsJson {
  return {
    amount:        facts.amount.toString(),
    currency:      facts.currency,
    beneficiaryId: facts.beneficiaryId,
    referenceId:   facts.referenceId,
  };
}

function jsonToFacts(j: FactsJson): ReturnType<typeof deriveFacts> {
  return {
    amount:        BigInt(j.amount),
    currency:      j.currency as Hex,
    beneficiaryId: j.beneficiaryId as Hex,
    referenceId:   j.referenceId as Hex,
  };
}

// ─── Accès chaîne ─────────────────────────────────────────────────────────────

type ChainClients = {
  client: ReturnType<typeof publicClient>;
  marketAddress: `0x${string}`;
  chainId: bigint;
};

async function getRequestOnChain(clients: ChainClients, requestId: bigint) {
  return clients.client.readContract({
    address: clients.marketAddress,
    abi: marketAbi,
    functionName: 'getRequest',
    args: [requestId],
  });
}

async function isCommitteeMember(clients: ChainClients, requestId: bigint, address: `0x${string}`) {
  return clients.client.readContract({
    address: clients.marketAddress,
    abi: marketAbi,
    functionName: 'isCommitteeMember',
    args: [requestId, address],
  });
}

// ─── Routeur ─────────────────────────────────────────────────────────────────

// Status enum (mirrors IVerificationMarket.Status)
const STATUS_NAMES = ['None', 'Commit', 'Reveal', 'Contest', 'Closed'] as const;

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: Required<CacheStartOpts>,
  clients: ChainClients,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://127.0.0.1`);
  const path = url.pathname;

  // POST /content
  if (req.method === 'POST' && path === '/content') {
    await handlePostContent(req, res, opts, clients);
    return;
  }

  // GET /content/{h}
  const contentMatch = path.match(/^\/content\/([0-9a-fA-Fx]+)$/);
  if (req.method === 'GET' && contentMatch) {
    const h = contentMatch[1] as Hex;
    const requestId = url.searchParams.get('requestId');
    await handleGetContent(req, res, opts, clients, h, requestId);
    return;
  }

  // POST /detail/{requestId}
  const detailMatch = path.match(/^\/detail\/(\d+)$/);
  if (req.method === 'POST' && detailMatch) {
    const requestId = BigInt(detailMatch[1]);
    await handlePostDetail(req, res, opts, clients, requestId);
    return;
  }

  // GET /detail/{requestId}
  if (req.method === 'GET' && detailMatch) {
    const requestId = BigInt(detailMatch[1]);
    await handleGetDetail(req, res, opts, clients, requestId, url);
    return;
  }

  replyJson(res, 404, { error: 'Route inconnue' });
}

// POST /content
async function handlePostContent(
  req: IncomingMessage,
  res: ServerResponse,
  opts: Required<CacheStartOpts>,
  _clients: ChainClients,
): Promise<void> {
  // Vérification du Bearer token
  if (!checkBearer(req, [opts.writeToken])) {
    throw new HttpError(401, 'Authorization: Bearer token requis');
  }

  const body = await readJsonBody<{ payload?: string; facts?: FactsJson }>(req);

  if (typeof body.payload !== 'string') {
    throw new HttpError(400, 'payload (base64) manquant');
  }
  if (!body.facts || typeof body.facts !== 'object') {
    throw new HttpError(400, 'facts manquant');
  }

  const payloadBytes = Buffer.from(body.payload, 'base64');

  let parsed;
  try {
    parsed = validatePayload(payloadBytes);
  } catch (e) {
    throw new HttpError(400, `Payload invalide : ${(e as Error).message}`);
  }

  const derivedFacts = deriveFacts(parsed);

  // Vérifie que facts == deriveFacts(payload)
  const provided = body.facts;
  if (
    BigInt(provided.amount) !== derivedFacts.amount ||
    provided.currency.toLowerCase()      !== derivedFacts.currency.toLowerCase() ||
    provided.beneficiaryId.toLowerCase() !== derivedFacts.beneficiaryId.toLowerCase() ||
    provided.referenceId.toLowerCase()   !== derivedFacts.referenceId.toLowerCase()
  ) {
    throw new HttpError(400, 'facts ne correspondent pas à deriveFacts(payload)');
  }

  const contentHash = contentHashOf(payloadBytes);
  const h = hashOf(derivedFacts, contentHash);

  const contentPath = join(opts.dataDir, 'content', `${h}.bin`);
  const factsPath   = join(opts.dataDir, 'content', `${h}.facts.json`);

  // Idempotent : même h → 200, même réponse
  if (existsSync(contentPath)) {
    replyJson(res, 200, { contentHash, h });
    return;
  }

  atomicWrite(contentPath, payloadBytes);
  atomicWrite(factsPath, Buffer.from(JSON.stringify(factsToJson(derivedFacts))));

  replyJson(res, 200, { contentHash, h });
}

// GET /content/{h}?requestId=N
async function handleGetContent(
  req: IncomingMessage,
  res: ServerResponse,
  opts: Required<CacheStartOpts>,
  clients: ChainClients,
  h: Hex,
  requestIdStr: string | null,
): Promise<void> {
  if (!requestIdStr) throw new HttpError(400, 'requestId manquant');

  const requestId = BigInt(requestIdStr);

  // Vérification signature
  const authResult = await verifyRead(
    req.headers as Record<string, string | string[] | undefined>,
    clients.chainId,
    requestId,
    h,
  );
  if (!authResult.ok) throw new HttpError(401, authResult.reason);

  const callerAddress = authResult.address.toLowerCase();

  // Vérification sur la chaîne
  let onChain;
  try {
    onChain = await getRequestOnChain(clients, requestId);
  } catch {
    throw new HttpError(404, 'Demande introuvable sur la chaîne');
  }

  // Vérification que h correspond
  if (onChain.h.toLowerCase() !== h.toLowerCase()) {
    throw new HttpError(404, 'h ne correspond pas à la demande');
  }

  const statusName = STATUS_NAMES[onChain.status] ?? 'None';

  if (statusName === 'Closed' || statusName === 'None') {
    throw new HttpError(404, 'Demande fermée ou inexistante');
  }

  // Contrôle de rôle selon statut
  const isCommit  = statusName === 'Commit';
  const isReveal  = statusName === 'Reveal';
  const isContest = statusName === 'Contest';
  const requester = onChain.requester.toLowerCase();
  const isSecurity = opts.securityAddresses.includes(callerAddress);

  let authorized = false;

  if (isCommit || isReveal) {
    // membre du comité ou requester
    const isMember = await isCommitteeMember(clients, requestId, callerAddress as `0x${string}`);
    authorized = isMember || callerAddress === requester;
  } else if (isContest) {
    // requester ou sécurité uniquement (§8 interface.md / DESIGN.md §8)
    authorized = callerAddress === requester || isSecurity;
  }

  if (!authorized) throw new HttpError(403, 'Accès refusé : rôle insuffisant');

  const contentPath = join(opts.dataDir, 'content', `${h}.bin`);
  const factsPath   = join(opts.dataDir, 'content', `${h}.facts.json`);

  if (!existsSync(contentPath)) throw new HttpError(404, 'Contenu introuvable en cache');

  const payloadBytes = readFileSync(contentPath);
  const factsJson    = JSON.parse(readFileSync(factsPath, 'utf8')) as FactsJson;

  replyJson(res, 200, {
    payload: payloadBytes.toString('base64'),
    facts:   factsJson,
  });
}

// POST /detail/{requestId}
async function handlePostDetail(
  req: IncomingMessage,
  res: ServerResponse,
  opts: Required<CacheStartOpts>,
  clients: ChainClients,
  requestId: bigint,
): Promise<void> {
  const body = await readBody(req);
  const bodyHash = keccak256(new Uint8Array(body));

  // Vérifier que keccak256(octets) == detailHash révélé par au moins un membre du comité
  let committee: readonly `0x${string}`[];
  try {
    committee = await clients.client.readContract({
      address: clients.marketAddress,
      abi: marketAbi,
      functionName: 'getCommittee',
      args: [requestId],
    });
  } catch {
    throw new HttpError(409, 'Demande introuvable sur la chaîne');
  }

  let matchingVerifier: `0x${string}` | null = null;
  for (const verifier of committee) {
    const reveal = await clients.client.readContract({
      address: clients.marketAddress,
      abi: marketAbi,
      functionName: 'getReveal',
      args: [requestId, verifier],
    });
    if (reveal.revealed && reveal.detailHash.toLowerCase() === bodyHash.toLowerCase()) {
      matchingVerifier = verifier;
      break;
    }
  }

  if (!matchingVerifier) {
    throw new HttpError(409, 'keccak256(octets) ne correspond à aucun detailHash révélé');
  }

  const detailPath = join(
    opts.dataDir, 'detail', requestId.toString(), `${matchingVerifier.toLowerCase()}.bin`,
  );
  atomicWrite(detailPath, body);

  replyJson(res, 200, { ok: true });
}

// GET /detail/{requestId}
async function handleGetDetail(
  req: IncomingMessage,
  res: ServerResponse,
  opts: Required<CacheStartOpts>,
  clients: ChainClients,
  requestId: bigint,
  url: URL,
): Promise<void> {
  // On a besoin du h de la demande pour la signature
  let onChain;
  try {
    onChain = await getRequestOnChain(clients, requestId);
  } catch {
    throw new HttpError(404, 'Demande introuvable sur la chaîne');
  }

  const h = onChain.h as Hex;

  const authResult = await verifyRead(
    req.headers as Record<string, string | string[] | undefined>,
    clients.chainId,
    requestId,
    h,
  );
  if (!authResult.ok) throw new HttpError(401, authResult.reason);

  const callerAddress = authResult.address.toLowerCase();
  const statusName = STATUS_NAMES[onChain.status] ?? 'None';

  if (statusName !== 'Contest') {
    throw new HttpError(403, 'GET /detail disponible seulement en statut Contest');
  }

  const requester = onChain.requester.toLowerCase();
  const isSecurity = opts.securityAddresses.includes(callerAddress);

  if (callerAddress !== requester && !isSecurity) {
    throw new HttpError(403, 'Accès refusé : rôle insuffisant');
  }

  // Lire tous les fichiers détail pour cette demande
  const detailDir = join(opts.dataDir, 'detail', requestId.toString());
  if (!existsSync(detailDir)) {
    replyJson(res, 200, { details: [] });
    return;
  }

  const { readdirSync } = await import('node:fs');
  const files = readdirSync(detailDir).filter(f => f.endsWith('.bin'));

  const details = files.map(f => {
    const verifier = f.replace('.bin', '');
    const data = readFileSync(join(detailDir, f));
    return { verifier, detail: data.toString('base64') };
  });

  replyJson(res, 200, { details });
}

// ─── Boucle de surveillance RequestClosed ────────────────────────────────────

function startCleanupLoop(
  opts: Required<CacheStartOpts>,
  clients: ChainClients,
  signal: AbortSignal,
): void {
  const markerPath = join(opts.dataDir, 'last-block-cleanup.txt');

  async function tick() {
    if (signal.aborted) return;
    try {
      const latest = await clients.client.getBlockNumber();
      const lastStr = existsSync(markerPath)
        ? readFileSync(markerPath, 'utf8').trim()
        : '0';
      const fromBlock = BigInt(lastStr);
      const toBlock = latest;

      if (fromBlock >= toBlock) return;

      const logs = await clients.client.getContractEvents({
        address: clients.marketAddress,
        abi: marketAbi,
        eventName: 'RequestClosed',
        fromBlock,
        toBlock,
      });

      for (const log of logs) {
        const requestId = (log.args as { requestId?: bigint }).requestId;
        if (requestId == null) continue;

        // Récupérer h depuis la chaîne
        try {
          const req = await getRequestOnChain(clients, requestId);
          const h = req.h as Hex;

          // Supprimer contenu
          const contentPath = join(opts.dataDir, 'content', `${h}.bin`);
          const factsPath   = join(opts.dataDir, 'content', `${h}.facts.json`);
          if (existsSync(contentPath)) rmSync(contentPath);
          if (existsSync(factsPath))   rmSync(factsPath);

          // Supprimer détails
          const detailDir = join(opts.dataDir, 'detail', requestId.toString());
          if (existsSync(detailDir)) rmSync(detailDir, { recursive: true });
        } catch (e) {
          console.error(`Cleanup requestId ${requestId} échoué :`, e);
        }
      }

      atomicWrite(markerPath, Buffer.from((toBlock + 1n).toString()));
    } catch (e) {
      if (!signal.aborted) console.error('Cleanup loop error:', e);
    }
  }

  const interval = setInterval(tick, 5000);
  signal.addEventListener('abort', () => clearInterval(interval));
}

// ─── startCache ───────────────────────────────────────────────────────────────

export function startCache(opts: CacheStartOpts = {}): Promise<{ server: Server; stop: () => Promise<void> }> {
  const config = (() => {
    try { return getConfig(); } catch { return null; }
  })();

  const resolved: Required<CacheStartOpts> = {
    port:              opts.port              ?? config?.cachePort        ?? 8701,
    host:              opts.host              ?? '127.0.0.1',
    dataDir:           opts.dataDir           ?? config?.cacheDataDir     ?? resolve(import.meta.dirname, '..', 'data', 'cache'),
    writeToken:        opts.writeToken        ?? config?.cacheWriteToken  ?? '',
    securityAddresses: opts.securityAddresses ?? config?.securityAddresses ?? [],
    rpcUrl:            opts.rpcUrl            ?? config?.rpcUrl           ?? 'http://127.0.0.1:8545',
    chainId:           opts.chainId           ?? Number(config?.chainId ?? 191919),
    marketAddress:     opts.marketAddress     ?? config?.marketAddress    ?? ('0x0000000000000000000000000000000000000000' as `0x${string}`),
  };

  mkdirSync(join(resolved.dataDir, 'content'), { recursive: true });
  mkdirSync(join(resolved.dataDir, 'detail'),  { recursive: true });

  const clients: ChainClients = {
    client:        publicClient(resolved.rpcUrl, resolved.chainId),
    marketAddress: resolved.marketAddress,
    chainId:       BigInt(resolved.chainId),
  };

  const abortController = new AbortController();

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, resolved, clients);
    } catch (err) {
      handleError(res, err);
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(resolved.port, resolved.host, () => {
      console.log(`Cache server listening on ${resolved.host}:${resolved.port}`);
      startCleanupLoop(resolved, clients, abortController.signal);

      const stop = () =>
        new Promise<void>((res, rej) => {
          abortController.abort();
          server.close(err => (err ? rej(err) : res()));
        });

      resolve({ server, stop });
    });
    server.on('error', reject);
  });
}

// ─── Point d'entrée direct ────────────────────────────────────────────────────

// Détecte si ce fichier est le point d'entrée principal
const isMain = process.argv[1]?.endsWith('cache/server.ts') ||
               process.argv[1]?.endsWith('cache/server.js');

if (isMain) {
  startCache().catch(err => {
    console.error('Impossible de démarrer le cache:', err);
    process.exit(1);
  });
}
