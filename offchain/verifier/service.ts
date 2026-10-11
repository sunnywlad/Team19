// verifier/service.ts — service de vérification
// Exporte startVerifier(opts) → { stop, state }
// Se lance seul en direct avec VERIFIER_KEY.
//
// Logique principale (DESIGN.md § Service vérificateur) :
//   1. Sondage des journaux CommitteeDrawn + RequestCreated depuis le dernier bloc traité.
//   2. Pour chaque demande où il est membre du comité :
//      a. Lit le cache (lecture signée).
//      b. Contrôle hashOf(facts, keccak256(octets)) == h et facts == deriveFacts(payload).
//         Échec : vote 1, content_mismatch, incident vers INCIDENTS_LOG.
//      c. Lance l'évaluateur (EVALUATOR_CMD).
//   3. Commit pendant la fenêtre de commit (sel persisté sur disque avant envoi).
//   4. Reveal dès now >= commitDeadline + 3 s et avant revealDeadline.
//   5. POST /detail.
//   6. finalize, puis confirmer Contest/Closed et relire contestDeadline.
//   7. close après contestDeadline, confirmé par le reçu ou l'état Closed.

import { appendFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { keccak256, toHex } from 'viem';
import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { publicClient as makePublicClient, walletClient as makeWalletClient } from '../lib/chain.ts';
import { getConfig, verifierDataDir } from '../lib/config.ts';
import { contentHashOf, hashOf, commitmentOf } from '../lib/hash.ts';
import { validatePayload, deriveFacts } from '../lib/payload.ts';
import { reasonsToMask } from '../lib/reasons.ts';
import { pollLogs } from '../lib/events.ts';
import { getContent, postDetail } from '../lib/cacheClient.ts';
import { marketAbi } from '../abi/market.ts';
import { marketAbiWithErrors } from '../abi/marketErrors.ts';
import { sendControlled } from '../lib/revert.ts';
import type { ControlledResult } from '../lib/revert.ts';
import { StateStore } from './state.ts';
import type { RequestState, RequestStep } from './state.ts';
import { runEvaluator } from './evaluator.ts';

// ─── Types publics ────────────────────────────────────────────────────────────

export type VerifierOpts = {
  rpcUrl?: string;
  chainId?: number;
  marketAddress?: Hex;
  cacheUrl?: string;
  verifierKey?: Hex;
  dataDir?: string;
  evaluatorCmd?: string;
  evaluatorTimeoutMs?: number;
  incidentsLog?: string;
  pollMs?: number;
  // Horloge injectable (retourne les secondes depuis l'époque).
  // Par défaut : horloge murale.
  // En production : horloge murale. En tests avec evm_increaseTime : timestamp EVM.
  now?: () => Promise<number> | number;
};

export type VerifierHandle = {
  stop: () => void;
  state: StateStore;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_NAMES = ['None', 'Commit', 'Reveal', 'Contest', 'Closed'] as const;

function statusName(n: number): string {
  return STATUS_NAMES[n] ?? 'Unknown';
}

// ─── startVerifier ────────────────────────────────────────────────────────────

export function startVerifier(opts: VerifierOpts = {}): VerifierHandle {
  // ── Config ──
  const config = (() => { try { return getConfig(); } catch { return null; } })();

  const rpcUrl       = opts.rpcUrl           ?? config?.rpcUrl           ?? 'http://127.0.0.1:9654';
  const chainIdNum   = opts.chainId          ?? Number(config?.chainId ?? 191919);
  const chainId      = BigInt(chainIdNum);
  const marketAddress = opts.marketAddress   ?? config?.marketAddress    ?? ('' as Hex);
  const cacheUrl     = opts.cacheUrl         ?? config?.cacheUrl         ?? 'http://127.0.0.1:8701';
  const verifierKey  = opts.verifierKey      ?? config?.verifierKey      ?? ('' as Hex);
  const evaluatorCmd = opts.evaluatorCmd     ?? config?.evaluatorCmd     ?? 'node evaluator-stub/index.ts';
  const timeoutMs    = opts.evaluatorTimeoutMs ?? config?.evaluatorTimeoutMs ?? 90_000;
  const incidentsLog = opts.incidentsLog     ?? config?.incidentsLog     ?? 'offchain/incidents.log';
  const pollMs       = opts.pollMs           ?? config?.pollMs           ?? 1_000;

  // Horloge : par défaut, horloge murale (secondes).
  // En tests avec evm_increaseTime : timestamp EVM injecté via opts.now.
  // Ne pas lire block.timestamp : sur un L1 inactif, le dernier bloc peut avoir
  // un timestamp très en retard sur l'horloge murale (aucun bloc ne mine entre
  // deux transactions), rendant les décisions commit→reveal non déterministes.
  const nowFn: () => Promise<number> | number = opts.now ?? (() => Math.floor(Date.now() / 1000));

  if (!verifierKey) throw new Error('VERIFIER_KEY manquante');
  if (!marketAddress) throw new Error('MARKET_ADDRESS manquante');

  const account = privateKeyToAccount(verifierKey);
  const verifierAddress = account.address.toLowerCase() as Hex;

  const dataDir = opts.dataDir ?? verifierDataDir(verifierAddress);
  mkdirSync(dataDir, { recursive: true });

  const store = new StateStore(dataDir);

  const pubClient  = makePublicClient(rpcUrl, chainIdNum);
  const wltClient  = makeWalletClient(verifierKey, rpcUrl, chainIdNum);

  // Dernier bloc traité (fichier sur disque via le store lui-même)
  // On garde ça en mémoire, réinitialisé à 0n au premier démarrage.
  let lastBlock = 0n;

  // Demandes en cours d'évaluation (pour ne pas relancer l'évaluateur)
  const evaluating = new Set<string>();
  const unknownReceipts = new Map<string, number>();

  // ── Fonctions utilitaires sur la chaîne ──

  async function getRequestOnChain(requestId: bigint) {
    return pubClient.readContract({
      address: marketAddress,
      abi: marketAbi,
      functionName: 'getRequest',
      args: [requestId],
    });
  }

  // ── Incident log ──

  function appendIncident(fields: Record<string, unknown>): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...fields }) + '\n';
    try {
      appendFileSync(incidentsLog, line, 'utf8');
    } catch {
      // ne pas crasher si le chemin n'est pas accessible
    }
  }

  function isFatalResult(
    state: RequestState,
    step: 'commit' | 'reveal' | 'finalize' | 'close',
    result: ControlledResult,
  ): boolean {
    if (result.status === 'reverted') {
      console.log(`[verifier] ${step} annulé requestId=${state.requestId} name=${result.name ?? 'unknown'} classe=${result.classe} sent=${result.sent}`);
    }
    const key = `${state.requestId}:${step}`;
    let fatal = result.status === 'reverted' && result.classe === 'fatal';
    if (result.status === 'reverted' && result.classe === 'unknown' && result.sent) {
      const count = (unknownReceipts.get(key) ?? 0) + 1;
      unknownReceipts.set(key, count);
      fatal = count >= 5;
    } else {
      unknownReceipts.delete(key);
    }
    if (fatal && result.status === 'reverted') {
      unknownReceipts.delete(key);
      appendIncident({
        verifier: verifierAddress,
        requestId: state.requestId,
        h: state.h,
        cause: 'tx_reverted',
        step,
        error: result.name ?? 'unknown',
      });
    }
    return fatal;
  }

  // ── Évaluation + détermination du vote ──

  async function evaluate(
    requestId: bigint,
    h: Hex,
    payloadBytes: Buffer,
    factsFromCache: { amount: string; currency: string; beneficiaryId: string; referenceId: string },
  ): Promise<{ vote: number; reasons: number; detail: string; detailHash: Hex }> {
    // Contrôle 1 : hashOf(facts, keccak256(octets)) == h
    const contentHash = contentHashOf(payloadBytes);
    const factsObj = {
      amount:        BigInt(factsFromCache.amount),
      currency:      factsFromCache.currency as Hex,
      beneficiaryId: factsFromCache.beneficiaryId as Hex,
      referenceId:   factsFromCache.referenceId as Hex,
    };
    const computedH = hashOf(factsObj, contentHash);

    if (computedH.toLowerCase() !== h.toLowerCase()) {
      const detail = JSON.stringify({
        ts: new Date().toISOString(),
        cause: 'content_mismatch',
        reason: 'hashOf ne correspond pas',
        requestId: requestId.toString(),
      });
      appendIncident({ verifier: verifierAddress, requestId: requestId.toString(), h, cause: 'content_mismatch' });
      const reasons = reasonsToMask(['content_mismatch']);
      const detailBytes = Buffer.from(detail);
      return { vote: 1, reasons, detail, detailHash: keccak256(new Uint8Array(detailBytes)) };
    }

    // Contrôle 2 : facts == deriveFacts(payload)
    let parsed;
    try {
      parsed = validatePayload(payloadBytes);
    } catch {
      const detail = JSON.stringify({
        ts: new Date().toISOString(),
        cause: 'content_mismatch',
        reason: 'payload invalide',
        requestId: requestId.toString(),
      });
      appendIncident({ verifier: verifierAddress, requestId: requestId.toString(), h, cause: 'content_mismatch' });
      const reasons = reasonsToMask(['content_mismatch']);
      const detailBytes = Buffer.from(detail);
      return { vote: 1, reasons, detail, detailHash: keccak256(new Uint8Array(detailBytes)) };
    }

    const derivedFacts = deriveFacts(parsed);
    if (
      derivedFacts.amount !== factsObj.amount ||
      derivedFacts.currency.toLowerCase() !== factsObj.currency.toLowerCase() ||
      derivedFacts.beneficiaryId.toLowerCase() !== factsObj.beneficiaryId.toLowerCase() ||
      derivedFacts.referenceId.toLowerCase() !== factsObj.referenceId.toLowerCase()
    ) {
      const detail = JSON.stringify({
        ts: new Date().toISOString(),
        cause: 'content_mismatch',
        reason: 'facts ne correspondent pas à deriveFacts(payload)',
        requestId: requestId.toString(),
      });
      appendIncident({ verifier: verifierAddress, requestId: requestId.toString(), h, cause: 'content_mismatch' });
      const reasons = reasonsToMask(['content_mismatch']);
      const detailBytes = Buffer.from(detail);
      return { vote: 1, reasons, detail, detailHash: keccak256(new Uint8Array(detailBytes)) };
    }

    // Lance l'évaluateur
    const evalResult = await runEvaluator(evaluatorCmd, payloadBytes, timeoutMs);

    if (!evalResult.ok) {
      const reasons = reasonsToMask([evalResult.cause]);
      const detailBytes = Buffer.from(evalResult.detail);
      return {
        vote: 1,
        reasons,
        detail: evalResult.detail,
        detailHash: keccak256(new Uint8Array(detailBytes)),
      };
    }

    const detailBytes = Buffer.from(evalResult.detail);
    return {
      vote: evalResult.vote,
      reasons: evalResult.reasons,
      detail: evalResult.detail,
      detailHash: keccak256(new Uint8Array(detailBytes)),
    };
  }

  // ── Traitement d'une demande (machine à états) ──

  async function processRequest(state: RequestState): Promise<void> {
    const requestId = BigInt(state.requestId);
    const rawNow = await nowFn();
    // nowFn returns seconds (block.timestamp) or ms (wall clock > 1e12)
    const nowSecNorm = rawNow > 1e12 ? Math.floor(rawNow / 1000) : rawNow;
    const commitDeadline = Number(state.commitDeadline);
    const revealDeadline = Number(state.revealDeadline);

    // ── Étape : pending → committed ──
    if (state.step === 'pending') {
      // Vérifier si déjà committée sur la chaîne (reprise après crash)
      try {
        const reveal = await pubClient.readContract({
          address: marketAddress,
          abi: marketAbi,
          functionName: 'getReveal',
          args: [requestId, account.address],
        });
        if (reveal.committed) {
          // Commit déjà fait, passer à la prochaine étape
          store.set({ ...state, step: 'committed' });
          return;
        }
      } catch (err) {
        // Ne pas confondre une lecture impossible avec l'absence de commit.
        console.error(`[verifier] Erreur lecture commit requestId=${requestId}:`, err);
        if (nowSecNorm >= commitDeadline) return;
      }

      if (nowSecNorm >= commitDeadline) {
        // Commit manqué : poursuivre la finalisation et la clôture de la demande.
        store.set({ ...state, step: 'detailed' });
        return;
      }

      // Évaluer si pas déjà en cours
      if (evaluating.has(state.requestId)) return;
      evaluating.add(state.requestId);

      let evalResult: { vote: number; reasons: number; detail: string; detailHash: Hex };
      try {
        const cached = await getContent(cacheUrl, account, chainId, requestId, state.h);
        const payloadBytes = Buffer.from(cached.payload, 'base64');
        evalResult = await evaluate(requestId, state.h, payloadBytes, cached.facts);
      } catch (err) {
        // Cache injoignable
        const detail = JSON.stringify({
          ts: new Date().toISOString(),
          cause: 'content_mismatch',
          reason: `cache injoignable : ${String(err)}`,
          requestId: state.requestId,
        });
        appendIncident({ verifier: verifierAddress, requestId: state.requestId, h: state.h, cause: 'content_mismatch' });
        const reasons = reasonsToMask(['content_mismatch']);
        const detailBytes = Buffer.from(detail);
        evalResult = {
          vote: 1,
          reasons,
          detail,
          detailHash: keccak256(new Uint8Array(detailBytes)),
        };
      } finally {
        evaluating.delete(state.requestId);
      }

      // Générer le sel et persister AVANT le commit
      const saltBytes = randomBytes(32);
      const salt = toHex(saltBytes) as Hex;

      const newState: RequestState = {
        ...state,
        vote: evalResult.vote,
        reasons: evalResult.reasons,
        detailHash: evalResult.detailHash,
        salt,
        detail: evalResult.detail,
        step: 'pending', // reste pending jusqu'au succès du commit
      };
      // Persistance du sel et du vote AVANT l'envoi
      store.set(newState);

      const commitment = commitmentOf({
        chainId,
        market: marketAddress,
        requestId,
        verifier: account.address,
        vote: evalResult.vote,
        reasons: evalResult.reasons,
        detailHash: evalResult.detailHash,
        salt,
      });

      try {
        const result = await sendControlled({
          publicClient: pubClient,
          walletClient: wltClient,
          address: marketAddress,
          abi: marketAbiWithErrors,
          call: { functionName: 'commitVerdict', args: [requestId, commitment] },
          force: false,
        });
        if (isFatalResult(newState, 'commit', result)) {
          store.set({ ...newState, step: 'detailed' });
        } else if (result.status === 'success' || result.classe === 'done') {
          store.set({ ...newState, step: 'committed' });
        }
      } catch (err) {
        console.error(`[verifier] Erreur commit requestId=${requestId}:`, err);
        // Réessayer au tour suivant (step reste pending).
      }
      return;
    }

    // ── Étape : committed → revealed ──
    if (state.step === 'committed') {
      // Décision basée sur l'horloge murale (nowFn), jamais sur le statut lu par eth_call.
      // Sur un L1 inactif, block.timestamp reste figé après le dernier bloc : getRequest
      // rendrait Commit indéfiniment même après commitDeadline → interblocage.
      // Reveal quand : now >= commitDeadline + 3 ET now < revealDeadline.
      if (nowSecNorm < commitDeadline + 3) return; // trop tôt
      if (nowSecNorm >= revealDeadline) {
        // Fenêtre de reveal manquée : sauter directement à finalize
        store.set({ ...state, step: 'detailed' });
        return;
      }

      // Vérifier si déjà révélé sur la chaîne (anti double-reveal, reprise après crash)
      try {
        const reveal = await pubClient.readContract({
          address: marketAddress,
          abi: marketAbi,
          functionName: 'getReveal',
          args: [requestId, account.address],
        });
        if (reveal.revealed) {
          store.set({ ...state, step: 'revealed' });
          return;
        }
      } catch {
        // pas de reveal disponible, continuer
      }

      try {
        const result = await sendControlled({
          publicClient: pubClient,
          walletClient: wltClient,
          address: marketAddress,
          abi: marketAbiWithErrors,
          call: {
            functionName: 'revealVerdict',
            args: [requestId, state.vote, state.reasons, state.detailHash, state.salt],
          },
          force: true,
        });
        if (isFatalResult(state, 'reveal', result)) {
          store.set({ ...state, step: 'detailed' });
        } else if (result.status === 'success' || result.classe === 'done') {
          store.set({ ...state, step: 'revealed' });
        }
      } catch (err) {
        console.error(`[verifier] Erreur reveal requestId=${requestId}:`, err);
      }
      return;
    }

    // ── Étape : revealed → detailed ──
    if (state.step === 'revealed') {
      try {
        const detailBytes = Buffer.from(state.detail, 'utf8');
        await postDetail(cacheUrl, requestId, detailBytes);
        store.set({ ...state, step: 'detailed' });
      } catch (err) {
        // 409 = détail déjà posté ou non autorisé ; on passe quand même
        const code = (err as { status?: number }).status;
        if (code === 409 || code === 404) {
          store.set({ ...state, step: 'detailed' });
        } else {
          console.error(`[verifier] Erreur POST /detail requestId=${requestId}:`, err);
        }
      }
      return;
    }

    // ── Étape : detailed → finalized ──
    if (state.step === 'detailed') {
      // Finalize dès que les 3 reveals sont visibles via getReveal, OU dès que
      // now >= revealDeadline + 2 (le contrat autorise finalize après revealDeadline même
      // sans 3 reveals). Décision sur l'horloge murale (nowFn), pas sur le statut eth_call.
      // WrongPhase/TooEarly = bloc encore en retard, réessayer au prochain tick.

      // Vérifier d'abord si déjà finalisé par un autre (Contest/Closed on-chain)
      try {
        const onChain = await getRequestOnChain(requestId);
        const sName = statusName(onChain.status);
        if (sName === 'Contest' || sName === 'Closed') {
          store.set({ ...state, step: 'finalized', contestDeadline: onChain.contestDeadline.toString() });
          return;
        }
      } catch {
        // Réessayer au tour suivant si la lecture échoue
        return;
      }

      // Compter les reveals visibles via getReveal (sans faire confiance au statut)
      let revealCount = 0;
      try {
        const committee = await pubClient.readContract({
          address: marketAddress,
          abi: marketAbi,
          functionName: 'getCommittee',
          args: [requestId],
        }) as readonly `0x${string}`[];
        for (const member of committee) {
          const rev = await pubClient.readContract({
            address: marketAddress,
            abi: marketAbi,
            functionName: 'getReveal',
            args: [requestId, member],
          });
          if (rev.revealed) revealCount++;
        }
      } catch {
        // Continuer avec revealCount = 0 (on se basera sur l'horloge)
      }

      const allRevealed = revealCount >= 3;
      const pastRevealDeadline = nowSecNorm >= revealDeadline + 2;

      if (!allRevealed && !pastRevealDeadline) return; // pas encore prêt

      let fatal = false;
      try {
        const result = await sendControlled({
          publicClient: pubClient,
          walletClient: wltClient,
          address: marketAddress,
          abi: marketAbiWithErrors,
          call: { functionName: 'finalize', args: [requestId] },
          force: true,
        });
        fatal = isFatalResult(state, 'finalize', result);
        if (fatal) store.set({ ...state, step: 'closed' });
      } catch (err) {
        console.error(`[verifier] Erreur finalize requestId=${requestId}:`, err);
      }

      // Quel que soit le résultat, seule la chaîne confirme la finalisation.
      try {
        const updated = await getRequestOnChain(requestId);
        const sName = statusName(updated.status);
        if (!fatal && (sName === 'Contest' || sName === 'Closed')) {
          store.set({
            ...state,
            step: 'finalized',
            contestDeadline: updated.contestDeadline.toString(),
          });
        }
      } catch (err) {
        console.error(`[verifier] Erreur relecture finalize requestId=${requestId}:`, err);
      }
      return;
    }

    // ── Étape : finalized → closed ──
    if (state.step === 'finalized') {
      try {
        const onChain = await getRequestOnChain(requestId);
        if (statusName(onChain.status) === 'Closed') {
          store.set({ ...state, step: 'closed' });
          return;
        }

        // Réparer aussi un état finalized persisté avec une échéance nulle.
        const contestDeadline = Number(onChain.contestDeadline);
        if (contestDeadline === 0 && statusName(onChain.status) !== 'Contest') {
          // Une ancienne finalisation annulée doit pouvoir être retentée.
          store.set({ ...state, step: 'detailed', contestDeadline: '0' });
          return;
        }
        if (state.contestDeadline !== onChain.contestDeadline.toString()) {
          state = { ...state, contestDeadline: onChain.contestDeadline.toString() };
          store.set(state);
        }
        if (contestDeadline === 0) return;
        // close quand now >= contestDeadline + 2 (marge inchangée).
        if (nowSecNorm < contestDeadline + 2) return;

        const result = await sendControlled({
          publicClient: pubClient,
          walletClient: wltClient,
          address: marketAddress,
          abi: marketAbiWithErrors,
          call: { functionName: 'close', args: [requestId] },
          force: true,
        });
        if (isFatalResult(state, 'close', result) || result.status === 'success') {
          store.set({ ...state, step: 'closed' });
        } else {
          const updated = await getRequestOnChain(requestId);
          if (statusName(updated.status) === 'Closed') {
            store.set({ ...state, step: 'closed' });
          }
        }
      } catch (err) {
        console.error(`[verifier] Erreur close requestId=${requestId}:`, err);
      }
      return;
    }
  }

  // ── Boucle principale ──

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      // 1. Sondage des journaux
      const { logs, nextBlock } = await pollLogs(pubClient, marketAddress, lastBlock);
      lastBlock = nextBlock;

      // Indexer les RequestCreated par requestId
      const requestCreatedMap = new Map<string, {
        h: Hex;
        commitDeadline: bigint;
        revealDeadline: bigint;
      }>();

      for (const log of logs) {
        if (log.eventName === 'RequestCreated') {
          const args = log.args as {
            requestId?: bigint;
            h?: Hex;
            commitDeadline?: bigint;
            revealDeadline?: bigint;
          };
          if (args.requestId != null) {
            requestCreatedMap.set(String(args.requestId), {
              h: args.h ?? '0x' as Hex,
              commitDeadline: args.commitDeadline ?? 0n,
              revealDeadline: args.revealDeadline ?? 0n,
            });
          }
        }
      }

      // 2. CommitteeDrawn : enregistrer les nouvelles demandes où on est membre
      for (const log of logs) {
        if (log.eventName !== 'CommitteeDrawn') continue;
        const args = log.args as { requestId?: bigint; committee?: readonly Hex[] };
        if (!args.requestId || !args.committee) continue;

        const requestIdStr = String(args.requestId);

        // Déjà connu
        if (store.get(args.requestId)) continue;

        // Vérifier si on est dans le comité
        const isMember = args.committee.some(
          a => a.toLowerCase() === verifierAddress.toLowerCase(),
        );
        if (!isMember) continue;

        // Récupérer h et les échéances depuis RequestCreated (même bloc) ou depuis la chaîne
        let h: Hex;
        let commitDeadline: bigint;
        let revealDeadline: bigint;

        const fromLog = requestCreatedMap.get(requestIdStr);
        if (fromLog) {
          h = fromLog.h;
          commitDeadline = fromLog.commitDeadline;
          revealDeadline = fromLog.revealDeadline;
        } else {
          // Relire depuis la chaîne
          try {
            const onChain = await getRequestOnChain(args.requestId);
            h = onChain.h;
            commitDeadline = onChain.commitDeadline;
            revealDeadline = onChain.revealDeadline;
          } catch {
            continue;
          }
        }

        const newState: RequestState = {
          requestId: requestIdStr,
          h,
          commitDeadline: commitDeadline.toString(),
          revealDeadline: revealDeadline.toString(),
          contestDeadline: '0',
          vote: 1,
          reasons: 0,
          detailHash: ('0x' + '00'.repeat(32)) as Hex,
          salt: ('0x' + '00'.repeat(32)) as Hex,
          detail: '',
          step: 'pending',
        };
        store.set(newState);
      }

      // 3. Traiter toutes les demandes actives
      const active = store.all().filter(s => s.step !== 'closed');
      for (const state of active) {
        // Pas de await parallèle : on traite séquentiellement pour éviter les doubles commits
        await processRequest(state);
      }
    } catch (err) {
      if (!stopped) {
        console.error('[verifier] Erreur dans tick:', err);
      }
    }

    if (!stopped) {
      timer = setTimeout(() => { tick().catch(() => {}); }, pollMs);
    }
  }

  // Démarrer la boucle
  tick().catch(() => {});

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    state: store,
  };
}

// ─── Point d'entrée direct ────────────────────────────────────────────────────

const isMain = process.argv[1]?.endsWith('verifier/service.ts') ||
               process.argv[1]?.endsWith('verifier/service.js');

if (isMain) {
  try {
    startVerifier();
    console.log('[verifier] Service démarré');
  } catch (err) {
    console.error('[verifier] Impossible de démarrer:', err);
    process.exit(1);
  }
}
