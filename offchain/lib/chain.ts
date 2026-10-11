// lib/chain.ts — publicClient, walletClient, définition de chaîne viem (id 191919 par défaut)

import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

// Chaîne par défaut : VETO local (id 191919)
export function vetoChain(chainId: number = 191919) {
  return defineChain({
    id: chainId,
    name: 'VETO Local',
    nativeCurrency: { name: 'VETO', symbol: 'VETO', decimals: 18 },
    rpcUrls: {
      default: { http: [] }, // surcharge à la création du client
    },
  });
}

export function publicClient(rpcUrl: string, chainId: number = 191919) {
  return createPublicClient({
    chain: vetoChain(chainId),
    transport: http(rpcUrl),
    cacheTime: 0,
    pollingInterval: 500,
  });
}

export function walletClient(privateKey: Hex, rpcUrl: string, chainId: number = 191919) {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: vetoChain(chainId),
    transport: http(rpcUrl),
  });
}
