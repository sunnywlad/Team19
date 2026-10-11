// Coffre réel, par viem. L'ABI vient de specs/contract/IArgentVault.sol.
// La clé du relais (RELAYER) ne sert qu'à payer le gaz de submit().
import {
  BaseError,
  RpcRequestError,
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  keccak256,
  type Address,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { argentVaultAbi } from "./abi.ts";
import { toStruct } from "./signer.ts";
import type { Hex, SignedRequest } from "./types.ts";
import type { EventArgs, SubmitOutcome, VaultClient, VaultEvent, VaultState } from "./vault.ts";

export type ChainVaultConfig = {
  rpcUrl: string;
  chainId: number;
  address: Address;
  /** Absente : le relais ne soumet rien (échec fermé). L'indexeur fonctionne quand même. */
  relayerKey?: Hex;
  timeoutMs?: number;
};

// Le nœud a répondu qu'il connaît déjà la transaction : elle a pu partir.
const MAYBE_BROADCAST = /already known|known transaction|nonce too low|replacement/i;

function describe(error: unknown): string {
  // shortMessage ne contient ni l'URL du RPC ni les paramètres de la requête.
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.name : "erreur inconnue";
}

function normalize(value: unknown): string | number | boolean {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value).toLowerCase();
}

// Champs uint64 de chaque événement (échéances et durées, en secondes).
const UINT64_FIELDS = new Map<string, Set<string>>();
for (const item of argentVaultAbi) {
  if (item.type !== "event") continue;
  UINT64_FIELDS.set(item.name, new Set(item.inputs.filter((input) => input.type === "uint64").map((input) => input.name)));
}

/**
 * Arguments décodés d'un événement, sous la forme d'EventArgs : les entiers
 * 256 bits en chaîne décimale, les uint64 (HoldPlaced.deadline, délais) en
 * nombre, comme block_timestamp et comme FakeVault. Un uint64 hors des entiers
 * sûrs reste une chaîne plutôt que de perdre en précision.
 */
export function eventArgs(eventName: string, decoded: Record<string, unknown>): EventArgs {
  const seconds = UINT64_FIELDS.get(eventName);
  const args: EventArgs = {};
  for (const [key, value] of Object.entries(decoded)) {
    args[key] = typeof value === "bigint" && seconds?.has(key) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : normalize(value);
  }
  return args;
}

export class ChainVault implements VaultClient {
  readonly #client: PublicClient;
  readonly #config: ChainVaultConfig;
  readonly #account: PrivateKeyAccount | null;
  readonly #timestamps = new Map<bigint, number>();

  constructor(config: ChainVaultConfig) {
    this.#config = config;
    this.#account = config.relayerKey ? privateKeyToAccount(config.relayerKey) : null;
    this.#client = createPublicClient({
      transport: http(config.rpcUrl, { timeout: config.timeoutMs ?? 5000, retryCount: 0 }),
    });
  }

  get relayerAddress(): Address | null {
    return this.#account?.address ?? null;
  }

  async submit(request: SignedRequest): Promise<SubmitOutcome> {
    const account = this.#account;
    if (!account) return { kind: "not_sent", cause: "clé RELAYER absente" };

    // Phase 1 : préparation. Tout échec ici est certain : rien n'est parti.
    let serialized: Hex;
    try {
      const chainId = await this.#client.getChainId();
      if (chainId !== this.#config.chainId) return { kind: "not_sent", cause: "chainId inattendu" };
      const data = encodeFunctionData({ abi: argentVaultAbi, functionName: "submit", args: [toStruct(request), request.signature] });
      const tx = { account: account.address, to: this.#config.address, data };
      // Un refus métier ne fait pas échouer la transaction ; un échec ici veut
      // dire rôle manquant ou transfert impossible : inutile de payer du gaz.
      const gas = await this.#client.estimateGas(tx);
      const nonce = await this.#client.getTransactionCount({ address: account.address, blockTag: "pending" });
      const fees = await this.#client.estimateFeesPerGas();
      serialized = await account.signTransaction({
        chainId,
        to: this.#config.address,
        data,
        nonce,
        gas: (gas * 12n) / 10n,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        type: "eip1559",
      });
    } catch (error) {
      return { kind: "not_sent", cause: describe(error) };
    }

    // Phase 2 : diffusion. Sans réponse nette du nœud, on ne sait pas.
    const txHash = keccak256(serialized);
    try {
      await this.#client.sendRawTransaction({ serializedTransaction: serialized });
      return { kind: "sent", txHash };
    } catch (error) {
      const rejected = error instanceof BaseError && error.walk((e) => e instanceof RpcRequestError) instanceof RpcRequestError;
      const cause = describe(error);
      if (rejected && !MAYBE_BROADCAST.test(error instanceof Error ? error.message : "")) {
        return { kind: "not_sent", cause };
      }
      return { kind: "unknown", cause, txHash };
    }
  }

  async agentPaused(agentId: Hex): Promise<boolean> {
    return this.#client.readContract({
      address: this.#config.address,
      abi: argentVaultAbi,
      functionName: "agentPaused",
      args: [agentId],
    });
  }

  async blockNumber(): Promise<bigint> {
    // Sans cache : viem garde sinon le dernier numéro quelques secondes, et
    // l'indexeur croirait la chaîne arrêtée.
    return this.#client.getBlockNumber({ cacheTime: 0 });
  }

  async events(fromBlock: bigint, toBlock: bigint): Promise<VaultEvent[]> {
    const logs = await this.#client.getLogs({ address: this.#config.address, fromBlock, toBlock });
    const out: VaultEvent[] = [];
    for (const log of logs) {
      if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue;
      let decoded: { eventName: string; args: unknown };
      try {
        decoded = decodeEventLog({ abi: argentVaultAbi, data: log.data, topics: log.topics });
      } catch {
        continue; // Événement hors de l'interface gelée : ignoré.
      }
      const args = eventArgs(decoded.eventName, (decoded.args ?? {}) as Record<string, unknown>);
      out.push({
        name: decoded.eventName,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        blockTimestamp: await this.#timestamp(log.blockNumber),
        args,
      });
    }
    return out;
  }

  /**
   * Les vues de specs/02 § 4, toutes lues au même bloc. Une vue en échec vaut
   * null ; si le bloc lui-même ne peut pas être lu, l'appel échoue.
   */
  async state(): Promise<VaultState> {
    const block = await this.#client.getBlock({ blockTag: "latest" });
    const at = { address: this.#config.address, abi: argentVaultAbi, blockNumber: block.number } as const;
    const amount = async (functionName: "cash" | "admittedDebts" | "safetyReserve" | "totalHeld" | "heldPlacements" | "placeable" | "threshold"): Promise<string | null> => {
      try {
        return (await this.#client.readContract({ ...at, functionName })).toString();
      } catch {
        return null;
      }
    };
    const paused = async (): Promise<boolean | null> => {
      try {
        return await this.#client.readContract({ ...at, functionName: "vaultPaused" });
      } catch {
        return null;
      }
    };
    const [cash, debts, reserve, held, heldPlacements, placeable, threshold, vaultPaused] = await Promise.all([
      amount("cash"),
      amount("admittedDebts"),
      amount("safetyReserve"),
      amount("totalHeld"),
      amount("heldPlacements"),
      amount("placeable"),
      amount("threshold"),
      paused(),
    ]);
    return {
      block_number: Number(block.number),
      block_timestamp: Number(block.timestamp),
      cash_wei: cash,
      admitted_debts_wei: debts,
      safety_reserve_wei: reserve,
      total_held_wei: held,
      held_placements_wei: heldPlacements,
      placeable_wei: placeable,
      threshold_wei: threshold,
      vault_paused: vaultPaused,
    };
  }

  async #timestamp(blockNumber: bigint): Promise<number> {
    const cached = this.#timestamps.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await this.#client.getBlock({ blockNumber });
    const ts = Number(block.timestamp);
    this.#timestamps.set(blockNumber, ts);
    return ts;
  }
}
