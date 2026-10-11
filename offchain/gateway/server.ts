// gateway/server.ts — passerelle HTTP (port 8700 par défaut)
// Exporte startGateway(opts) → { server, stop } pour les tests.
// Se lance seule quand exécutée directement.
//
// Toutes les routes exigent Authorization: Bearer <clé de GATEWAY_API_KEYS>.
// Disjoncteur : si INCIDENTS_LOG existe et n'est pas vide, POST /requests → 503.
// POST /rpc : lecture seule uniquement.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { getConfig } from '../lib/config.ts';
import { validatePayload, deriveFacts } from '../lib/payload.ts';
import { contentHashOf, hashOf } from '../lib/hash.ts';
import {
  readBody, readJsonBody, replyJson, handleError, checkBearer, HttpError,
} from '../lib/http.ts';
import { postContent, getContent, getDetail, CacheClientError } from '../lib/cacheClient.ts';
import { pollLogs } from '../lib/events.ts';
import { publicClient, walletClient } from '../lib/chain.ts';
import { marketAbi } from '../abi/market.ts';
import { marketAbiWithErrors } from '../abi/marketErrors.ts';
import { sendControlled, revertName } from '../lib/revert.ts';
import { stringify } from '../lib/json.ts';
import { signRead } from '../lib/readAuth.ts';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GatewayStartOpts = {
  port?: number;
  host?: string;
  apiKeys?: string[];
  requesterKey?: Hex;
  cacheUrl?: string;
  cacheWriteToken?: string;
  rpcUrl?: string;
  chainId?: number;
  marketAddress?: `0x${string}`;
  incidentsLog?: string;
};

type ResolvedOpts = Required<GatewayStartOpts>;

// ─── Méthodes RPC autorisées (lecture seule) ──────────────────────────────────

const ALLOWED_RPC_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_getLogs',
  'eth_getBlockByNumber',
  'eth_getTransactionReceipt',
  'eth_getBalance',
  'eth_getCode',
]);

// ─── Helpers chaîne ───────────────────────────────────────────────────────────

// Noms de statuts (miroir de IVerificationMarket.Status)
const STATUS_NAMES = ['None', 'Commit', 'Reveal', 'Contest', 'Closed'] as const;

// Noms de codes (miroir de IVerificationMarket.Code)
const CODE_NAMES = ['Refuse', 'HumanReview', 'Accept'] as const;

async function readRequest(opts: ResolvedOpts, requestId: bigint) {
  const client = publicClient(opts.rpcUrl, opts.chainId);
  return client.readContract({
    address: opts.marketAddress,
    abi: marketAbi,
    functionName: 'getRequest',
    args: [requestId],
  });
}

async function readFee(opts: ResolvedOpts): Promise<bigint> {
  const client = publicClient(opts.rpcUrl, opts.chainId);
  return client.readContract({
    address: opts.marketAddress,
    abi: marketAbi,
    functionName: 'requestFee',
    args: [],
  }) as Promise<bigint>;
}

// ─── Disjoncteur ──────────────────────────────────────────────────────────────

function circuitOpen(incidentsLog: string): boolean {
  if (!existsSync(incidentsLog)) return false;
  try {
    const st = statSync(incidentsLog);
    return st.size > 0;
  } catch {
    return false;
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

// POST /requests
async function handlePostRequests(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ResolvedOpts,
): Promise<void> {
  // Disjoncteur
  if (circuitOpen(opts.incidentsLog)) {
    throw new HttpError(503, 'Service suspendu : incidents détectés. Videz incidents.log pour rétablir.');
  }

  // Lire le corps brut (payload)
  const bodyBytes = await readBody(req);

  // Valider le payload
  let payload;
  try {
    payload = validatePayload(bodyBytes);
  } catch (e) {
    throw new HttpError(400, `Payload invalide : ${(e as Error).message}`);
  }

  // Vérifier que requester == adresse de REQUESTER_KEY
  if (!opts.requesterKey) {
    throw new HttpError(500, 'REQUESTER_KEY non configurée');
  }
  const requesterAccount = privateKeyToAccount(opts.requesterKey);
  if (payload.requester.toLowerCase() !== requesterAccount.address.toLowerCase()) {
    throw new HttpError(400, `payload.requester (${payload.requester}) ne correspond pas à REQUESTER_KEY (${requesterAccount.address})`);
  }

  // Dériver les faits
  const facts = deriveFacts(payload);

  // Calculer h localement pour vérification
  const contentHash = contentHashOf(bodyBytes);
  const expectedH = hashOf(facts, contentHash);

  // POST /content au cache
  let cacheResult;
  try {
    cacheResult = await postContent(opts.cacheUrl, opts.cacheWriteToken, bodyBytes, facts);
  } catch (e) {
    if (e instanceof CacheClientError) {
      throw new HttpError(502, `Cache error ${e.status}: ${e.message}`);
    }
    throw new HttpError(502, `Cache inaccessible: ${(e as Error).message}`);
  }

  // Vérifier que le h rendu par le cache correspond
  if (cacheResult.h.toLowerCase() !== expectedH.toLowerCase()) {
    throw new HttpError(502, `Incohérence cache : h rendu (${cacheResult.h}) ≠ h calculé (${expectedH})`);
  }

  const h = cacheResult.h as Hex;

  // Envoyer createRequest(h) sur la chaîne
  const wClient = walletClient(opts.requesterKey, opts.rpcUrl, opts.chainId);
  const fee = await readFee(opts);

  let txHash: Hex;
  try {
    txHash = await wClient.writeContract({
      address: opts.marketAddress,
      abi: marketAbi,
      functionName: 'createRequest',
      args: [h],
      value: fee,
    });
  } catch (e) {
    throw new HttpError(502, `createRequest échoué : ${(e as Error).message}`);
  }

  // Attendre le reçu
  const pClient = publicClient(opts.rpcUrl, opts.chainId);
  let receipt;
  try {
    receipt = await pClient.waitForTransactionReceipt({ hash: txHash });
  } catch (e) {
    throw new HttpError(502, `waitForTransactionReceipt échoué : ${(e as Error).message}`);
  }

  // Lire RequestCreated pour récupérer requestId, commitDeadline, revealDeadline
  const logs = await pClient.getContractEvents({
    address: opts.marketAddress,
    abi: marketAbi,
    eventName: 'RequestCreated',
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });

  const log = logs.find(l => (l.args as { h?: Hex }).h?.toLowerCase() === h.toLowerCase());
  if (!log) {
    throw new HttpError(502, 'Événement RequestCreated introuvable dans le reçu');
  }

  const args = log.args as {
    requestId: bigint;
    h: Hex;
    fee: bigint;
    commitDeadline: bigint;
    revealDeadline: bigint;
  };

  // Répondre avec les informations de la demande (bigint en chaînes)
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(stringify({
    requestId: args.requestId,
    h: args.h,
    txHash,
    commitDeadline: args.commitDeadline,
    revealDeadline: args.revealDeadline,
  }));
}

// GET /requests/{id}
async function handleGetRequest(
  _req: IncomingMessage,
  res: ServerResponse,
  opts: ResolvedOpts,
  requestId: bigint,
): Promise<void> {
  let onChain;
  try {
    onChain = await readRequest(opts, requestId);
  } catch {
    throw new HttpError(404, `Demande ${requestId} introuvable`);
  }

  const statusName = STATUS_NAMES[onChain.status] ?? 'None';
  if (statusName === 'None') {
    throw new HttpError(404, `Demande ${requestId} introuvable`);
  }

  const result: Record<string, unknown> = {
    status: statusName,
    deadlines: {
      commit: onChain.commitDeadline.toString(),
      reveal: onChain.revealDeadline.toString(),
      contest: onChain.contestDeadline.toString(),
    },
  };

  // code seulement à partir de Contest
  if (statusName === 'Contest' || statusName === 'Closed') {
    result['code'] = CODE_NAMES[onChain.code] ?? 'HumanReview';
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(stringify(result));
}

// GET /requests/{id}/verdicts
async function handleGetVerdicts(
  _req: IncomingMessage,
  res: ServerResponse,
  opts: ResolvedOpts,
  requestId: bigint,
): Promise<void> {
  const pClient = publicClient(opts.rpcUrl, opts.chainId);

  let onChain;
  try {
    onChain = await readRequest(opts, requestId);
  } catch {
    throw new HttpError(404, `Demande ${requestId} introuvable`);
  }

  // Récupérer tous les VerdictRevealed et VerifierMissed pour cette demande
  const latestBlock = await pClient.getBlockNumber();
  const revealedLogs = await pClient.getContractEvents({
    address: opts.marketAddress,
    abi: marketAbi,
    eventName: 'VerdictRevealed',
    fromBlock: 0n,
    toBlock: latestBlock,
  });

  const missedLogs = await pClient.getContractEvents({
    address: opts.marketAddress,
    abi: marketAbi,
    eventName: 'VerifierMissed',
    fromBlock: 0n,
    toBlock: latestBlock,
  });

  const verdicts = revealedLogs
    .filter(l => (l.args as { requestId?: bigint }).requestId === requestId)
    .map(l => {
      const a = l.args as {
        requestId: bigint;
        verifier: string;
        vote: number;
        reasons: number;
        detailHash: string;
      };
      return {
        verifier: a.verifier,
        vote: CODE_NAMES[a.vote] ?? 'HumanReview',
        reasons: a.reasons,
        detailHash: a.detailHash,
      };
    });

  const missed = missedLogs
    .filter(l => (l.args as { requestId?: bigint }).requestId === requestId)
    .map(l => {
      const a = l.args as { requestId: bigint; verifier: string; committed: boolean };
      return { verifier: a.verifier, committed: a.committed };
    });

  const result: Record<string, unknown> = { verdicts, missed };

  // Si statut Contest : lire les détails depuis le cache (lecture signée avec la clé du demandeur)
  const statusName = STATUS_NAMES[onChain.status] ?? 'None';
  if (statusName === 'Contest' && opts.requesterKey) {
    const requesterAccount = privateKeyToAccount(opts.requesterKey);
    try {
      const details = await getDetail(
        opts.cacheUrl,
        requesterAccount,
        BigInt(opts.chainId),
        requestId,
        onChain.h as Hex,
      );
      result['details'] = details.details;
    } catch (e) {
      // Détails indisponibles : on les omet sans erreur fatale
      result['details'] = null;
      result['detailsError'] = (e as Error).message;
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(stringify(result));
}

// POST /requests/{id}/finalize
async function handleFinalize(
  _req: IncomingMessage,
  res: ServerResponse,
  opts: ResolvedOpts,
  requestId: bigint,
): Promise<void> {
  if (!opts.requesterKey) {
    throw new HttpError(500, 'REQUESTER_KEY non configurée');
  }

  const wClient = walletClient(opts.requesterKey, opts.rpcUrl, opts.chainId);
  const pClient = publicClient(opts.rpcUrl, opts.chainId);
  let onChain;
  try {
    onChain = await readRequest(opts, requestId);
  } catch (e) {
    if (revertName(e) === 'UnknownRequest') {
      throw new HttpError(404, `Demande ${requestId} introuvable`);
    }
    throw new HttpError(502, `lecture avant finalize échouée : ${String(e)}`);
  }

  const initialStatus = STATUS_NAMES[onChain.status] ?? 'None';
  if (initialStatus === 'Commit' || initialStatus === 'Reveal') {
    try {
      await sendControlled({
        publicClient: pClient,
        walletClient: wClient,
        address: opts.marketAddress,
        abi: marketAbiWithErrors,
        call: { functionName: 'finalize', args: [requestId] },
        force: BigInt(Math.floor(Date.now() / 1000)) >= onChain.revealDeadline,
      });
    } catch (e) {
      // Les annulations sont des résultats ; les erreurs réseau/nonce remontent.
      throw new HttpError(502, `finalize échoué : ${String(e)}`);
    }

    // Lire l'état après finalize pour tenter close si contestDeadline passée.
    try {
      onChain = await readRequest(opts, requestId);
    } catch (e) {
      if (revertName(e) === 'UnknownRequest') {
        throw new HttpError(404, `Demande ${requestId} introuvable`);
      }
      throw new HttpError(502, `lecture après finalize échouée : ${String(e)}`);
    }
  }

  const statusName = STATUS_NAMES[onChain.status] ?? 'None';

  // Tenter close si en Contest et contestDeadline passée
  if (statusName === 'Contest') {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now >= onChain.contestDeadline) {
      try {
        await sendControlled({
          publicClient: pClient,
          walletClient: wClient,
          address: opts.marketAddress,
          abi: marketAbiWithErrors,
          call: { functionName: 'close', args: [requestId] },
          force: true,
        });
        onChain = await readRequest(opts, requestId);
      } catch (e) {
        throw new HttpError(502, `close échoué : ${String(e)}`);
      }
    }
  }

  const finalStatus = STATUS_NAMES[onChain.status] ?? 'None';
  const result: Record<string, unknown> = {
    status: finalStatus,
    deadlines: {
      commit: onChain.commitDeadline.toString(),
      reveal: onChain.revealDeadline.toString(),
      contest: onChain.contestDeadline.toString(),
    },
  };

  if (finalStatus === 'Contest' || finalStatus === 'Closed') {
    result['code'] = CODE_NAMES[onChain.code] ?? 'HumanReview';
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(stringify(result));
}

// GET /events?fromBlock=N
async function handleGetEvents(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ResolvedOpts,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const fromBlockStr = url.searchParams.get('fromBlock') ?? '0';

  // Valider que fromBlock est un entier non négatif
  if (!/^\d+$/.test(fromBlockStr)) {
    throw new HttpError(400, `fromBlock invalide : "${fromBlockStr}" n'est pas un entier`);
  }

  const fromBlock = BigInt(fromBlockStr);

  const pClient = publicClient(opts.rpcUrl, opts.chainId);
  const { logs, nextBlock } = await pollLogs(pClient, opts.marketAddress, fromBlock);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(stringify({ logs, nextBlock }));
}

// POST /rpc
async function handleRpc(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ResolvedOpts,
): Promise<void> {
  const body = await readBody(req);

  let rpcRequest: unknown;
  try {
    rpcRequest = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Corps JSON invalide');
  }

  // Batch ou simple
  const isBatch = Array.isArray(rpcRequest);
  const requests = isBatch ? (rpcRequest as unknown[]) : [rpcRequest];

  const responses = await Promise.all(
    requests.map(async (r) => {
      const rpc = r as { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
      const id = rpc.id ?? null;

      if (!rpc.method) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32600, message: 'Requête invalide : méthode manquante' },
        };
      }

      if (!ALLOWED_RPC_METHODS.has(rpc.method)) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Méthode non autorisée : ${rpc.method}` },
        };
      }

      // Relayer vers le RPC
      try {
        const upstream = await fetch(opts.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: rpc.jsonrpc ?? '2.0',
            id,
            method: rpc.method,
            params: rpc.params ?? [],
          }),
        });
        const text = await upstream.text();
        try {
          return JSON.parse(text);
        } catch {
          return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Réponse RPC non-JSON' } };
        }
      } catch (e) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: `RPC inaccessible : ${(e as Error).message}` },
        };
      }
    }),
  );

  const result = isBatch ? responses : responses[0];
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

// ─── Routeur ──────────────────────────────────────────────────────────────────

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ResolvedOpts,
): Promise<void> {
  const rawUrl = req.url ?? '/';
  const urlObj = new URL(rawUrl, 'http://127.0.0.1');
  const path = urlObj.pathname;

  // Authentification Bearer sur toutes les routes
  if (!checkBearer(req, opts.apiKeys)) {
    throw new HttpError(401, 'Authorization: Bearer <clé> requis');
  }

  // POST /requests
  if (req.method === 'POST' && path === '/requests') {
    await handlePostRequests(req, res, opts);
    return;
  }

  // POST /requests/{id}/finalize
  const finalizeMatch = path.match(/^\/requests\/(\d+)\/finalize$/);
  if (req.method === 'POST' && finalizeMatch) {
    await handleFinalize(req, res, opts, BigInt(finalizeMatch[1]));
    return;
  }

  // GET /requests/{id}/verdicts
  const verdictsMatch = path.match(/^\/requests\/(\d+)\/verdicts$/);
  if (req.method === 'GET' && verdictsMatch) {
    await handleGetVerdicts(req, res, opts, BigInt(verdictsMatch[1]));
    return;
  }

  // GET /requests/{id}
  const requestMatch = path.match(/^\/requests\/(\d+)$/);
  if (req.method === 'GET' && requestMatch) {
    await handleGetRequest(req, res, opts, BigInt(requestMatch[1]));
    return;
  }

  // GET /events
  if (req.method === 'GET' && path === '/events') {
    await handleGetEvents(req, res, opts);
    return;
  }

  // POST /rpc
  if (req.method === 'POST' && path === '/rpc') {
    await handleRpc(req, res, opts);
    return;
  }

  replyJson(res, 404, { error: 'Route inconnue' });
}

// ─── startGateway ─────────────────────────────────────────────────────────────

export function startGateway(
  opts: GatewayStartOpts = {},
): Promise<{ server: Server; stop: () => Promise<void> }> {
  const config = (() => {
    try { return getConfig(); } catch { return null; }
  })();

  const resolved: ResolvedOpts = {
    port:             opts.port             ?? config?.gatewayPort       ?? 8700,
    host:             opts.host             ?? '127.0.0.1',
    apiKeys:          opts.apiKeys          ?? config?.gatewayApiKeys    ?? [],
    requesterKey:     opts.requesterKey     ?? config?.requesterKey      ?? ('' as Hex),
    cacheUrl:         opts.cacheUrl         ?? config?.cacheUrl          ?? 'http://127.0.0.1:8701',
    cacheWriteToken:  opts.cacheWriteToken  ?? config?.cacheWriteToken   ?? '',
    rpcUrl:           opts.rpcUrl           ?? config?.rpcUrl            ?? 'http://127.0.0.1:9654',
    chainId:          opts.chainId          ?? Number(config?.chainId ?? 191919),
    marketAddress:    opts.marketAddress    ?? config?.marketAddress     ?? ('0x0000000000000000000000000000000000000000' as `0x${string}`),
    incidentsLog:     opts.incidentsLog     ?? config?.incidentsLog      ?? resolve(import.meta.dirname, '..', 'incidents.log'),
  };

  const server = createServer(async (req, res) => {
    try {
      await handleRequest(req, res, resolved);
    } catch (err) {
      handleError(res, err);
    }
  });

  return new Promise((resolveP, rejectP) => {
    server.listen(resolved.port, resolved.host, () => {
      console.log(`Gateway server listening on ${resolved.host}:${resolved.port}`);

      const stop = () =>
        new Promise<void>((res, rej) => {
          server.close(err => (err ? rej(err) : res()));
        });

      resolveP({ server, stop });
    });
    server.on('error', rejectP);
  });
}

// ─── Point d'entrée direct ────────────────────────────────────────────────────

const isMain =
  process.argv[1]?.endsWith('gateway/server.ts') ||
  process.argv[1]?.endsWith('gateway/server.js');

if (isMain) {
  startGateway().catch(err => {
    console.error('Impossible de démarrer la passerelle:', err);
    process.exit(1);
  });
}
