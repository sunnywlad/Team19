// VAULT_MODE=chain : lance anvil, déploie ArgentVault (src/ArgentVault.sol) par
// script/DeployArgentVault.s.sol et inscrit le monde de test (seed.mjs). Si le
// script de déploiement manque, lib.mjs arrête « make demo » avant d'arriver
// ici : « ArgentVault absent : VAULT_MODE=chain impossible ». Aucun repli sur le
// faux coffre.
//
// Vérifié contre ArgentVault sur anvil (réseau de test local, chaîne 31337),
// par « make scenes » en VAULT_MODE=chain. Fuji non testé.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOY_SCRIPT, DemoError, HOST, ROOT, postJson, run, setChainVault, startService, stopService } from "./lib.mjs";

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
    // Un bloc par seconde : sans cela anvil ne mine qu'à chaque transaction, et
    // l'indexeur attendrait sans fin la confirmation de la dernière décision.
    args: ["--host", HOST, "--port", String(config.ports.anvil), "--chain-id", config.chainId, "--block-time", "1", "--silent"],
    // anvil n'a pas de /health : prêt quand il répond à eth_chainId.
    ready: async () => {
      try {
        const reply = await postJson(`http://${HOST}:${config.ports.anvil}`, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }, {}, 1500);
        return reply.status === 200 && typeof reply.body?.result === "string";
      } catch {
        return false;
      }
    },
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
