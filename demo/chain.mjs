// VAULT_MODE=chain : lance anvil, déploie ArgentVault par script/DeployArgentVault.s.sol
// et inscrit le monde de test. En mode RPC externe, le réseau doit correspondre
// à CHAIN_ID et VAULT_ADDRESS peut désigner un coffre existant dont le code est vérifié.
// Vérifié contre ArgentVault sur anvil (chaîne 31337) ; le mode RPC externe vise le L1 191919.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

/** Coffres des scènes externes : adresses seules, toutes consommées. */
export function recordConsumedVault(address, file = join(ROOT, "deployments", "argent-vault-aws.json")) {
  const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  state.consumedSceneVaults ??= [];
  if (!state.consumedSceneVaults.includes(address)) state.consumedSceneVaults.push(address);
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/** Prépare la chaîne et inscrit le monde de test. S'arrête à la première erreur. */
export async function bringUpChain(config, { fresh = false, record = recordConsumedVault, start = startService, stop = stopService, execute = run, rpc = postJson, save = setChainVault, read = readFileSync } = {}) {
  if (!existsSync(join(ROOT, DEPLOY_SCRIPT))) throw new DemoError("ArgentVault absent : VAULT_MODE=chain impossible");
  const keys = roleKeys(config);
  const external = config.get("RPC_URL") !== undefined;
  if (external) {
    let reply;
    try {
      reply = await rpc(config.rpcUrl, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    } catch {
      throw new DemoError("RPC externe indisponible : eth_chainId en échec");
    }
    if (reply.status !== 200 || !/^0x[0-9a-fA-F]+$/.test(reply.body?.result ?? "") || !/^\d+$/.test(config.chainId)) throw new DemoError("RPC externe : eth_chainId ou CHAIN_ID mal formé");
    if (BigInt(reply.body.result) !== BigInt(config.chainId)) throw new DemoError("RPC externe : chainId inattendu, différent de CHAIN_ID");
  } else {
    await stop("anvil");
    await start(anvilService(config));
  }

  let address = external && !fresh ? config.get("VAULT_ADDRESS") : undefined;
  if (address !== undefined) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new DemoError("variable d'environnement mal formée : VAULT_ADDRESS");
    let reply;
    try {
      reply = await rpc(config.rpcUrl, { jsonrpc: "2.0", id: 2, method: "eth_getCode", params: [address, "latest"] });
    } catch {
      throw new DemoError("RPC externe indisponible : eth_getCode en échec");
    }
    if (reply.status !== 200 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(reply.body?.result ?? "")) throw new DemoError("VAULT_ADDRESS sans code ou code illisible sur le RPC externe");
  } else {
    // La clé du propriétaire passe par l'environnement de forge, jamais par ses arguments.
    const forge = execute(config.get("FORGE") ?? "forge", ["script", DEPLOY_SCRIPT, "--rpc-url", config.rpcUrl, "--broadcast"], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...keys },
    });
    if (forge.status !== 0) throw new DemoError(`déploiement d'ArgentVault en échec (forge script, code ${forge.status}) : voir la sortie de forge, non reproduite ici`);
    const record = join(ROOT, "broadcast", "DeployArgentVault.s.sol", config.chainId, "run-latest.json");
    try {
      address = JSON.parse(read(record, "utf8")).transactions.find((t) => t.contractName === "ArgentVault" && t.contractAddress)?.contractAddress;
    } catch {
      address = undefined;
    }
    if (typeof address !== "string") throw new DemoError("adresse d'ArgentVault introuvable dans la sortie de forge");
  }
  save(address);
  if (external && fresh) record(address);

  const seed = execute(process.execPath, [join(ROOT, "demo", "seed.mjs")], { cwd: ROOT, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", RPC_URL: config.rpcUrl, CHAIN_ID: config.chainId, VAULT_ADDRESS: address, ...keys }, stdio: ["ignore", "inherit", "inherit"] });
  if (seed.status !== 0) throw new DemoError("inscription du monde de test en échec : voir ci-dessus");
}
