// lib/chain.ts — publicClient, walletClient, définition de chaîne viem (id 191919 par défaut)

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

// Chaîne par défaut : CHK local (id 191919)
export function chkChain(chainId: number = 191919) {
  return defineChain({
    id: chainId,
    name: 'CHK Local',
    nativeCurrency: { name: 'CHK', symbol: 'CHK', decimals: 18 },
    rpcUrls: {
      default: { http: [] }, // surcharge à la création du client
    },
  });
}

export function publicClient(rpcUrl: string, chainId: number = 191919) {
  return createPublicClient({
    chain: chkChain(chainId),
    transport: http(rpcUrl),
    cacheTime: 0,
    pollingInterval: 500,
  });
}

export function walletClient(privateKey: Hex, rpcUrl: string, chainId: number = 191919) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: chkChain(chainId),
    transport: http(rpcUrl),
  });
}
