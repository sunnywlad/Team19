// test/helpers/chain.ts
// Lance anvil, compile et déploie MockMarket.
// Exporte les utilitaires de gestion de la chaîne pour les tests d'intégration.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount, mnemonicToAccount } from 'viem/accounts';
import { toHex } from 'viem';
import type { Hex } from 'viem';
import { publicClient as makePublicClient, walletClient as makeWalletClient } from '../../lib/chain.ts';

export const FORGE = process.env['FORGE'] ?? 'forge';
export const ANVIL  = process.env['ANVIL']  ?? 'anvil';

export const MNEMONIC = 'test test test test test test test test test test test junk';
export const CHAIN_ID = 191919;

// Clés privées dérivées à l'exécution depuis le mnemonic public anvil (jamais de littéraux)
// 0=deployer, 1=committee0, 2=committee1, 3=committee2, 4=requester
export const ANVIL_KEYS: Hex[] = [0, 1, 2, 3, 4].map((i) => {
  const account = mnemonicToAccount(MNEMONIC, { addressIndex: i });
  const rawKey = account.getHdKey().privateKey;
  if (!rawKey) throw new Error(`Impossible de dériver la clé privée à l'index ${i}`);
  return toHex(rawKey) as Hex;
});

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise(res => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address() as { port: number };
      s.close(() => res(addr.port));
    });
  });
}

export async function startAnvil(port: number): Promise<{
  proc: ReturnType<typeof spawn>;
  rpcUrl: string;
}> {
  const rpcUrl = `http://127.0.0.1:${port}`;
  const proc = spawn(ANVIL, [
    '--chain-id', String(CHAIN_ID),
    '--port', String(port),
    '--mnemonic', MNEMONIC,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Anvil: timeout de démarrage (15s)')), 15_000);
    let resolved = false;
    const onData = (data: Buffer) => {
      if (resolved) return;
      if (data.toString().includes('Listening on')) {
        resolved = true;
        clearTimeout(timeout);
        setTimeout(resolve, 100);
      }
    };
    proc.stdout!.on('data', onData);
    proc.stderr!.on('data', onData);
    proc.on('error', (err) => { if (!resolved) { clearTimeout(timeout); reject(err); } });
    proc.on('close', (code) => {
      if (!resolved) { clearTimeout(timeout); reject(new Error(`Anvil exited with code ${code}`)); }
    });
  });

  return { proc, rpcUrl };
}

export async function deployMockMarket(
  rpcUrl: string,
  deployerKey: Hex,
  committee: [Hex, Hex, Hex],
  commitWindow = 180,
  revealWindow = 60,
  contestWindow = 600,
  fee = '100000000000000',
): Promise<Hex> {
  const mockDir = join(dirname(fileURLToPath(import.meta.url)), '../mock');
  return new Promise((resolve, reject) => {
    const proc = spawn(FORGE, [
      'create',
      '--rpc-url', rpcUrl,
      '--private-key', deployerKey,
      '--broadcast',
      'MockMarket.sol:MockMarket',
      '--constructor-args',
      `[${committee[0]},${committee[1]},${committee[2]}]`,
      String(commitWindow),
      String(revealWindow),
      String(contestWindow),
      fee,
    ], { cwd: mockDir, stdio: 'pipe' });
    let out = '';
    proc.stdout!.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr!.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) { reject(new Error(`forge create failed:\n${out}`)); return; }
      const m = out.match(/Deployed to: (0x[0-9a-fA-F]{40})/);
      if (!m) { reject(new Error(`Adresse non trouvée:\n${out}`)); return; }
      resolve(m[1] as Hex);
    });
  });
}

// Avance le temps anvil (evm_increaseTime + evm_mine)
export async function advanceTime(rpcUrl: string, seconds: number): Promise<void> {
  await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'evm_increaseTime', params: [seconds], id: 1 }),
  });
  await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'evm_mine', params: [], id: 2 }),
  });
}

export { makePublicClient, makeWalletClient, privateKeyToAccount };
export type { Hex };
