import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hex } from 'viem';
import { FORGE } from './chain.ts';

function forgeCreate(
  rpcUrl: string,
  deployerKey: Hex,
  contract: string,
  args: string[],
): Promise<Hex> {
  const mockDir = join(dirname(fileURLToPath(import.meta.url)), '../mock');
  return new Promise((resolve, reject) => {
    const proc = spawn(FORGE, [
      'create', '--rpc-url', rpcUrl, '--private-key', deployerKey, '--broadcast',
      contract, '--constructor-args', ...args,
    ], { cwd: mockDir, stdio: 'pipe' });
    let out = '';
    proc.stdout!.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr!.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) { reject(new Error(`forge create ${contract} failed:\n${out}`)); return; }
      const m = out.match(/Deployed to: (0x[0-9a-fA-F]{40})/);
      if (!m) { reject(new Error(`Adresse non trouvée pour ${contract}:\n${out}`)); return; }
      resolve(m[1] as Hex);
    });
  });
}

export async function deployPhase3Registry(rpcUrl: string, deployerKey: Hex, minStake: bigint): Promise<Hex> {
  return forgeCreate(rpcUrl, deployerKey, 'Phase3Market.sol:Phase3Registry', [minStake.toString()]);
}

export async function deployPhase3Market(
  rpcUrl: string,
  deployerKey: Hex,
  registryAddress: Hex,
  commitWindow = 30,
  revealWindow = 20,
  contestWindow = 20,
  fee = '100000000000000',
): Promise<Hex> {
  return forgeCreate(rpcUrl, deployerKey, 'Phase3Market.sol:Phase3Market', [
    fee, String(commitWindow), String(revealWindow), String(contestWindow), registryAddress,
  ]);
}
