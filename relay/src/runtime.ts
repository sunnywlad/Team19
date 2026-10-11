// Assemblage à partir de l'environnement. Les noms de variables sont ceux de
// relay/.env.example ; aucune valeur n'est affichée, les erreurs ne nomment que
// la variable.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AlertSink, AvailabilityAlert } from "./alerts.ts";
import { ChainVault } from "./chain-vault.ts";
import { DEFAULT_POLICY, intEnv, readEnv, requireEnv, type EnvName, type Policy } from "./config.ts";
import type { FakeVault } from "./fake-vault.ts";
import { domainFor } from "./signer.ts";
import { systemClock, type Hex } from "./types.ts";
import { ClosedVault, type VaultClient } from "./vault.ts";
import { fakeVaultFromFixtures, loadFixtures } from "./world.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const KEY = /^0x[0-9a-fA-F]{64}$/;

function matching(name: EnvName, pattern: RegExp, required: true): string;
function matching(name: EnvName, pattern: RegExp, required: false): string | undefined;
function matching(name: EnvName, pattern: RegExp, required: boolean): string | undefined {
  const value = required ? requireEnv(name) : readEnv(name);
  if (value !== undefined && !pattern.test(value)) throw new Error(`variable d'environnement mal formée : ${name}`);
  return value;
}

export function policyFromEnv(): Policy {
  return { ...DEFAULT_POLICY, confirmations: intEnv("CONFIRMATIONS", DEFAULT_POLICY.confirmations) };
}

export function chainId(): number {
  return intEnv("CHAIN_ID", 31337);
}

export function vaultAddress(): Address {
  return matching("VAULT_ADDRESS", ADDRESS, true) as Address;
}

/** Clé du client, pour le bouchon de l'IA du client uniquement. */
export function clientSignerKey(): Hex {
  return matching("CLIENT_SIGNER", KEY, true) as Hex;
}

export const FAKE_VAULT_NOTICE = "COFFRE SIMULÉ : aucun fonds, aucune chaîne";

/**
 * VAULT_MODE=fake : faux coffre en mémoire, dans l'état initial des fixtures.
 * Il ne garde de la clé du client que l'adresse, pour vérifier les signatures
 * du service « IA du client » lancé avec la même CLIENT_SIGNER.
 */
function fakeVaultFromEnv(): FakeVault {
  const clientSigner = privateKeyToAccount(clientSignerKey()).address.toLowerCase() as Address;
  return fakeVaultFromFixtures(loadFixtures(), { clientSigner, domain: domainFor(chainId(), vaultAddress()), policy: policyFromEnv(), clock: systemClock });
}

/**
 * VAULT_MODE absent ou « chain » : coffre réel si la configuration est
 * complète, coffre fermé sinon. Sans clé RELAYER, le coffre réel sert à
 * l'indexeur mais ne soumet rien. « fake » : faux coffre, rendu aussi dans
 * `fake`. Tout autre mode fait échouer le démarrage.
 */
export function vaultFromEnv(): { vault: VaultClient; note: string; fake: FakeVault | null } {
  const mode = readEnv("VAULT_MODE") ?? "chain";
  if (mode === "fake") {
    const fake = fakeVaultFromEnv();
    return { vault: fake, note: FAKE_VAULT_NOTICE, fake };
  }
  if (mode !== "chain") throw new Error("variable d'environnement mal formée : VAULT_MODE (attendu : fake ou chain)");
  const rpcUrl = readEnv("RPC_URL");
  if (rpcUrl === undefined || readEnv("VAULT_ADDRESS") === undefined) {
    return { vault: new ClosedVault("RPC_URL ou VAULT_ADDRESS absent"), note: "coffre fermé : RPC_URL ou VAULT_ADDRESS absent, rien ne sera soumis", fake: null };
  }
  const relayerKey = matching("RELAYER", KEY, false) as Hex | undefined;
  const vault = new ChainVault({ rpcUrl, chainId: chainId(), address: vaultAddress(), ...(relayerKey ? { relayerKey } : {}) });
  return { vault, note: relayerKey ? "coffre sur la chaîne, relais actif" : "coffre sur la chaîne, clé RELAYER absente : rien ne sera soumis", fake: null };
}

/** Chemin d'une base SQLite, dossier créé au besoin. */
export function dbPath(name: "QUEUE_DB" | "INDEX_DB" | "JOURNAL_OUTBOX_DB", fallback: string): string {
  const path = readEnv(name) ?? fallback;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  return path;
}

/** BOUCHON : écrit les alertes sur la sortie d'erreur. Le vrai envoi revient au service de réponse. */
export const stderrAlerts: AlertSink = {
  async availability(alert: AvailabilityAlert): Promise<void> {
    console.error(`[alerte de disponibilité] ${alert.kind} demande=${alert.request_id} agent=${alert.agent_id} attente=${alert.waited_s}s`);
  },
};
