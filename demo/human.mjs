// VAULT_MODE=chain : le geste de l'approbateur des scènes 6a et 6b, sur la chaîne.
//
//   node demo/human.mjs approve|refuse|expire <request_id>
//
// Signe avec APPROVER_PRIVATE_KEY (environnement, puis .env ; jamais affichée).
// « expire » n'a pas de rôle dans le contrat : la même clé ne sert qu'à payer
// le gaz. La décision ne se lit pas ici : elle est dans l'événement Decision.
//
// Vérifié contre ArgentVault sur anvil (réseau de test local), par les scènes
// 6a et 6b en VAULT_MODE=chain. Fuji non testé. En mode fake, ce
// geste passe par le port de contrôle du faux coffre (relay/src/demo-control.ts).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DemoError, VAR, loadConfig } from "./lib.mjs";
import { callVault, chainClients } from "./viem.mjs";

async function main([action, requestId]) {
  if (!["approve", "refuse", "expire"].includes(action) || !/^0x[0-9a-f]{64}$/.test(requestId ?? "")) {
    console.error("usage : node demo/human.mjs approve|refuse|expire <request_id>");
    return 64;
  }
  const config = loadConfig();
  const key = config.get("APPROVER_PRIVATE_KEY");
  if (key === undefined) throw new DemoError("variable d'environnement manquante : APPROVER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new DemoError("variable d'environnement mal formée : APPROVER_PRIVATE_KEY");
  const deployed = join(VAR, "chain.json");
  const address = existsSync(deployed) ? JSON.parse(readFileSync(deployed, "utf8")).vault_address : config.get("VAULT_ADDRESS");
  if (address === undefined) throw new DemoError("variable d'environnement manquante : VAULT_ADDRESS");
  try {
    const hash = await callVault(chainClients(config.rpcUrl, config.chainId), address, key, action, [requestId]);
    console.log(`${action} appelé, transaction ${hash}`);
    return 0;
  } catch (error) {
    // Le contrat a rejeté l'appel (NotAuthorized, NoPendingApproval, DeadlineNotReached…).
    console.log(error instanceof Error ? error.message : "erreur");
    return 1;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof DemoError)) throw error;
  console.error(`human : ${error.message}`);
  process.exitCode = 1;
}
