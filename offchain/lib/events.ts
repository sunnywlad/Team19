// lib/events.ts — sondage getLogs du marché par tranche depuis un bloc donné
// pollLogs rend les journaux décodés pour tous les événements du marché.

import type { PublicClient } from 'viem';
import { marketAbi } from '../abi/market.ts';

// Taille de tranche maximale pour un appel getLogs (protection contre les réponses trop grandes)
const CHUNK_SIZE = 500n;

export type MarketLog = {
  eventName: string;
  blockNumber: bigint;
  transactionHash: `0x${string}` | null;
  logIndex: number | null;
  args: Record<string, unknown>;
};

/**
 * pollLogs : récupère tous les journaux du marché depuis `fromBlock` jusqu'au bloc courant.
 * Les journaux sont décodés par viem via l'ABI du marché.
 * Les bigint dans args sont conservés tels quels (le sérialiseur JSON doit les gérer).
 *
 * @param client     Client viem public
 * @param market     Adresse du contrat marché
 * @param fromBlock  Premier bloc à inclure
 * @returns          Journaux décodés dans l'ordre, plus le prochain bloc à sonder
 */
export async function pollLogs(
  client: PublicClient,
  market: `0x${string}`,
  fromBlock: bigint,
): Promise<{ logs: MarketLog[]; nextBlock: bigint }> {
  const latest = await client.getBlockNumber();

  if (fromBlock > latest) {
    return { logs: [], nextBlock: fromBlock };
  }

  const all: MarketLog[] = [];

  // Découpage par tranches pour éviter les timeouts RPC
  for (let start = fromBlock; start <= latest; start += CHUNK_SIZE) {
    const end = start + CHUNK_SIZE - 1n < latest ? start + CHUNK_SIZE - 1n : latest;

    const raw = await client.getContractEvents({
      address: market,
      abi: marketAbi,
      fromBlock: start,
      toBlock: end,
    });

    for (const log of raw) {
      all.push({
        eventName: log.eventName ?? 'Unknown',
        blockNumber: log.blockNumber ?? 0n,
        transactionHash: log.transactionHash ?? null,
        logIndex: log.logIndex ?? null,
        args: (log.args ?? {}) as Record<string, unknown>,
      });
    }
  }

  return { logs: all, nextBlock: latest + 1n };
}
