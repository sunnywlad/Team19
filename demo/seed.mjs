// VAULT_MODE=chain : inscrit le monde de test de specs/examples/fixtures.json
// dans un ArgentVault déployé, par les fonctions de specs/contract/IArgentVault.sol.
//
//   node demo/seed.mjs      (lancé par « make demo » en mode chain)
//
// Variables, lues de l'environnement puis de .env, jamais affichées :
//   RPC_URL, CHAIN_ID, VAULT_ADDRESS
//   OWNER_PRIVATE_KEY       paramètres, agents, approvisionnement
//   ADMISSION_PRIVATE_KEY   bénéficiaires, factures, placements
// Une clé par rôle. Les étapes s'exécutent dans l'ordre et le script s'arrête
// à la première erreur.
//
// Anvil (31337) : les comptes des rôles sont crédités par anvil_setBalance.
// L1 AWS (191919) : les rôles sont déjà financés ; aucun appel anvil n'est fait.
// La caisse vient du solde du propriétaire. Les bénéficiaires ont des adresses
// synthétiques dont personne n'a la clé.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DemoError, ROOT, loadConfig } from "./lib.mjs";
import { accounts, callVault, chainClients, viem } from "./viem.mjs";

const ACTION = { PAY_INVOICE: 1, PLACE: 2 };

export async function seed(config = loadConfig(), { makeClients = chainClients, makeTestClient = viem.createTestClient, contractCall = callVault } = {}) {
  const need = (name, pattern) => {
    const value = config.get(name);
    if (value === undefined) throw new DemoError(`variable d'environnement manquante : ${name}`);
    if (!pattern.test(value)) throw new DemoError(`variable d'environnement mal formée : ${name}`);
    return value;
  };
  const KEY = /^0x[0-9a-fA-F]{64}$/;
  const address = need("VAULT_ADDRESS", /^0x[0-9a-fA-F]{40}$/);
  const owner = need("OWNER_PRIVATE_KEY", KEY);
  const admission = need("ADMISSION_PRIVATE_KEY", KEY);
  if (!["31337", "191919"].includes(config.chainId)) throw new DemoError("seed : chaîne de démo attendue (31337 ou 191919)");
  const localAnvil = config.chainId === "31337";

  const f = JSON.parse(readFileSync(join(ROOT, "specs", "examples", "fixtures.json"), "utf8"));
  const clients = makeClients(config.rpcUrl, config.chainId);
  const test = localAnvil ? makeTestClient({ chain: clients.chain, transport: clients.transport, mode: "anvil" }) : null;
  const syntheticAccount = (beneficiaryId) => viem.getAddress(`0x${beneficiaryId.slice(-40)}`);

  const steps = [];
  const step = (label, run) => steps.push({ label, run });
  const asOwner = (label, fn, args, value) => step(label, () => contractCall(clients, address, owner, fn, args, value));
  const asAdmission = (label, fn, args) => step(label, () => contractCall(clients, address, admission, fn, args));

  // Du gaz pour chaque rôle présent, et la caisse du propriétaire.
  for (const name of localAnvil ? ["OWNER_PRIVATE_KEY", "ADMISSION_PRIVATE_KEY", "RELAYER", "APPROVER_PRIVATE_KEY", "GUARDIAN_PRIVATE_KEY"] : []) {
    const key = config.get(name);
    if (key === undefined || !KEY.test(key)) continue;
    step(`gaz pour ${name}`, () => test.setBalance({ address: accounts.privateKeyToAccount(key).address, value: viem.parseEther("1") }));
  }
  asOwner("réserve de sécurité", "setSafetyReserve", [BigInt(f.vault.safety_reserve_wei)]);
  asOwner("seuil", "setThreshold", [BigInt(f.vault.threshold_wei)]);
  asOwner("délai d'approbation", "setApprovalDelay", [BigInt(f.vault.approval_delay_s)]);
  for (const a of f.agents) asOwner(`agent ${a.label}`, "registerAgent", [a.agent_id, a.mandate.reduce((bits, name) => bits | ACTION[name], 0)]);
  for (const b of f.beneficiaries) asAdmission(`bénéficiaire ${b.label}`, "registerBeneficiary", [b.beneficiary_id, syntheticAccount(b.beneficiary_id)]);
  for (const i of f.invoices) if (i.registered) asAdmission(`facture ${i.label}`, "registerInvoice", [i.invoice_id, f.ids[i.beneficiary], BigInt(i.amount_wei)]);
  for (const p of f.placements) asAdmission(`placement ${p.label}`, "registerPlacement", [p.placement_id, f.ids[p.beneficiary], BigInt(p.amount_wei)]);
  asOwner("approvisionnement (réseau de test)", "fund", [], BigInt(f.vault.cash_wei));

  for (const [n, { label, run }] of steps.entries()) {
    try {
      await run();
    } catch (error) {
      // Première erreur : on s'arrête, le reste n'est pas tenté.
      console.error(`seed : étape ${n + 1}/${steps.length} en échec (${label}) : ${error instanceof Error ? error.message : "erreur"}. Arrêt, ${steps.length - n - 1} étape(s) non tentée(s).`);
      return 1;
    }
    console.log(`seed : ${n + 1}/${steps.length} ${label}`);
  }
  console.log(localAnvil ? "seed : monde de test inscrit sur le réseau de test local" : "seed : monde de test inscrit sur le L1 AWS");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await seed();
  } catch (error) {
    if (!(error instanceof DemoError)) throw error;
    console.error(`seed : ${error.message}`);
    process.exitCode = 1;
  }
}
