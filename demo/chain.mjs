// VAULT_MODE=chain : SQUELETTE, en attente du contrat ArgentVault (Wladimir,
// src/ArgentVault.sol et script/DeployArgentVault.s.sol). Tant que le script de
// déploiement n'existe pas, lib.mjs arrête « make demo » avant d'arriver ici :
// « ArgentVault absent : VAULT_MODE=chain impossible ». Aucun repli sur le faux
// coffre.
//
// NON TESTÉ contre ArgentVault : le nom du contrat dans la sortie de forge et
// les variables que lira le script de déploiement sont des suppositions à
// reprendre quand il existera.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOY_SCRIPT, DemoError, HOST, ROOT, run, setChainVault, startService, stopService } from "./lib.mjs";

const ROLE_KEYS = ["OWNER_PRIVATE_KEY", "ADMISSION_PRIVATE_KEY", "RELAYER", "APPROVER_PRIVATE_KEY", "GUARDIAN_PRIVATE_KEY", "CLIENT_SIGNER"];

/** Les clés de rôle, lues de l'environnement ou de .env. Le message ne nomme que la variable. */
export function roleKeys(config) {
  const keys = {};
  for (const name of ROLE_KEYS) {
    const value = config.get(name);
    if (value === undefined) throw new DemoError(`variable d'environnement manquante : ${name}`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new DemoError(`variable d'environnement mal formée : ${name}`);
    keys[name] = value;
  }
  return keys;
}

export function anvilService(config) {
  return {
    name: "anvil",
    port: config.ports.anvil,
    cwd: ROOT,
    command: config.get("ANVIL") ?? "anvil",
    args: ["--host", HOST, "--port", String(config.ports.anvil), "--chain-id", config.chainId, "--silent"],
    // anvil répond 200 à un GET sur sa racine.
    health: `http://${HOST}:${config.ports.anvil}/`,
    env: () => ({}),
  };
}

/** Lance anvil, déploie ArgentVault, inscrit le monde de test. S'arrête à la première erreur. */
export async function bringUpChain(config) {
  if (!existsSync(join(ROOT, DEPLOY_SCRIPT))) throw new DemoError("ArgentVault absent : VAULT_MODE=chain impossible");
  const keys = roleKeys(config);
  await stopService("anvil");
  await startService(anvilService(config));

  // La clé du propriétaire passe par l'environnement de forge, jamais par ses arguments.
  const forge = run(config.get("FORGE") ?? "forge", ["script", DEPLOY_SCRIPT, "--rpc-url", config.rpcUrl, "--broadcast"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...keys },
  });
  if (forge.status !== 0) throw new DemoError(`déploiement d'ArgentVault en échec (forge script, code ${forge.status}) : voir la sortie de forge, non reproduite ici`);
  const record = join(ROOT, "broadcast", "DeployArgentVault.s.sol", config.chainId, "run-latest.json");
  let address;
  try {
    address = JSON.parse(readFileSync(record, "utf8")).transactions.find((t) => t.contractName === "ArgentVault" && t.contractAddress)?.contractAddress;
  } catch {
    address = undefined;
  }
  if (typeof address !== "string") throw new DemoError("adresse d'ArgentVault introuvable dans la sortie de forge");
  setChainVault(address);

  const seed = run(process.execPath, [join(ROOT, "demo", "seed.mjs")], { cwd: ROOT, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", RPC_URL: config.rpcUrl, CHAIN_ID: config.chainId, VAULT_ADDRESS: address, ...keys }, stdio: ["ignore", "inherit", "inherit"] });
  if (seed.status !== 0) throw new DemoError("inscription du monde de test en échec : voir ci-dessus");
}
