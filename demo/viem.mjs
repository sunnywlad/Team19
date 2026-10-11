// viem et l'ABI du coffre, pris dans relay/ : la démo n'ajoute aucune dépendance.
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const require = createRequire(join(ROOT, "relay", "package.json"));
export const viem = require("viem");
export const accounts = require("viem/accounts");
export const { argentVaultAbi } = await import("../relay/src/abi.ts");

export function chainClients(rpcUrl, chainId) {
  const chain = viem.defineChain({ id: Number(chainId), name: "demo", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const transport = viem.http(rpcUrl);
  return {
    chain,
    transport,
    publicClient: viem.createPublicClient({ chain, transport }),
    wallet: (key) => viem.createWalletClient({ chain, transport, account: accounts.privateKeyToAccount(key) }),
  };
}

/**
 * Appelle une fonction du coffre avec la clé d'un rôle et attend le reçu.
 * Simule d'abord : un appel que le contrat rejette n'est pas envoyé. L'erreur
 * rendue ne porte qu'un nom (erreur du contrat ou type d'erreur), jamais l'URL
 * du RPC ni une clé.
 */
export async function callVault({ publicClient, wallet }, address, key, functionName, args, value) {
  const client = wallet(key);
  try {
    const { request } = await publicClient.simulateContract({ address, abi: argentVaultAbi, functionName, args, account: client.account, ...(value === undefined ? {} : { value }) });
    const hash = await client.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("TransactionReverted");
    return hash;
  } catch (error) {
    const revert = error?.walk?.((e) => e?.data?.errorName !== undefined);
    throw new Error(revert?.data?.errorName ?? error?.name ?? "erreur", { cause: undefined });
  }
}
