import { ContractFunctionRevertedError } from 'viem';
import type { Hex } from 'viem';
import type { marketAbiWithErrors } from '../abi/marketErrors.ts';
import type { publicClient, walletClient } from './chain.ts';

export type RevertClass = 'done' | 'early' | 'fatal' | 'unknown';

function findRevert(err: unknown): ContractFunctionRevertedError | undefined {
  const seen = new Set<unknown>();
  let current = err;
  while (current && typeof current === 'object' && !seen.has(current)) {
    if (current instanceof ContractFunctionRevertedError) return current;
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function revertName(err: unknown): string | undefined {
  return findRevert(err)?.data?.errorName;
}

export function classifyRevert(name: string | undefined): RevertClass {
  switch (name) {
    case 'AlreadyCommitted':
    case 'AlreadyRevealed':
      return 'done';
    case 'WrongPhase':
    case 'TooEarly':
      return 'early';
    case 'CommitmentMismatch':
    case 'NoCommitment':
    case 'NotCommitteeMember':
    case 'RevealWindowClosed':
    case 'UnknownRequest':
      return 'fatal';
    default:
      return 'unknown';
  }
}

// L1 local, gasUsed max : phase 1 = 74 463 ; phase 3 = 80 447.
export const GAS_COMMIT = 200_000n;
// L1 local, gasUsed max : phase 1 = 63 840 ; phase 3 = 47 939.
export const GAS_REVEAL = 200_000n;
// L1 local : phase 1 = 50 738 ; phase 3 max = 697 650 (3 échantillons).
export const GAS_FINALIZE = 2_000_000n;
// Close jamais mesuré ; marge provisoire. Limite de bloc du L1 : 8 000 000.
export const GAS_CLOSE = 1_000_000n;

type MarketCall =
  | { functionName: 'commitVerdict'; args: readonly [bigint, Hex] }
  | { functionName: 'revealVerdict'; args: readonly [bigint, number, number, Hex, Hex] }
  | { functionName: 'finalize' | 'close'; args: readonly [bigint] };

export type ControlledResult =
  | { status: 'success'; sent: true }
  | { status: 'reverted'; name: string | undefined; classe: RevertClass; sent: boolean };

const GAS_BY_CALL = {
  commitVerdict: GAS_COMMIT,
  revealVerdict: GAS_REVEAL,
  finalize: GAS_FINALIZE,
  close: GAS_CLOSE,
} as const;

export async function sendControlled(opts: {
  publicClient: ReturnType<typeof publicClient>;
  walletClient: ReturnType<typeof walletClient>;
  address: Hex;
  abi: typeof marketAbiWithErrors;
  call: MarketCall;
  force: boolean;
}): Promise<ControlledResult> {
  const { publicClient: pc, walletClient: wc } = opts;
  const contract = {
    address: opts.address,
    abi: opts.abi,
    ...opts.call,
    account: wc.account,
  };
  const reverted = (name: string | undefined, sent: boolean): ControlledResult => ({
    status: 'reverted', name, classe: classifyRevert(name), sent,
  });

  try {
    await pc.simulateContract({ ...contract, blockTag: 'latest' });
  } catch (err) {
    if (!findRevert(err)) throw err;
    const name = revertName(err);
    if (classifyRevert(name) !== 'early' || !opts.force) return reverted(name, false);
    // Horloge murale prête, dernier bloc en retard : envoyer l'appel utile à gaz fixe.
  }

  let hash: Hex;
  try {
    hash = await wc.writeContract({ ...contract, gas: GAS_BY_CALL[opts.call.functionName] });
  } catch (err) {
    if (!findRevert(err)) throw err;
    return reverted(revertName(err), false);
  }
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status === 'success') return { status: 'success', sent: true };

  // Le reçu n'a pas de données de revert. Rejouer dans son bloc pour les décoder.
  try {
    await pc.simulateContract({ ...contract, blockNumber: receipt.blockNumber });
  } catch (err) {
    if (!findRevert(err)) throw err;
    return reverted(revertName(err), true);
  }
  // Le rejeu réussit malgré le reçu annulé (p. ex. panne de gaz) : raison inconnue.
  return reverted(undefined, true);
}
