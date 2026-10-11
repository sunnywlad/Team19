// Ce que la DOUBLURE StubVault (relay/test/fixtures/StubVault.sol) permet de
// vérifier du mode chain, sur anvil, sans ArgentVault.
//
//   node demo/chain-check.mjs       (make demo-chain-check ; anvil et forge requis)
//
// Vérifié ici : anvil lancé par la démo ; les services en VAULT_MODE=chain ; une
// demande partie de la vraie porte, signée par l'IA du client, soumise par le
// relais avec la clé RELAYER, décidée par un contrat, relue par l'indexeur et
// recopiée dans le journal ; aucun port de contrôle en mode chain ; seed.mjs et
// human.mjs qui s'arrêtent sur le premier appel que le contrat rejette.
//
// PAS vérifié ici (« VAULT_MODE=chain make demo » puis « make scenes » le jouent contre
// ArgentVault) : le déploiement par forge script, l'inscription
// du monde de test, approve / refuse / expire, et toute règle de paiement. La
// doublure accepte une demande sans rien payer : ce script ne prouve aucun
// paiement.
//
// Les clés sont tirées pour ce lancement et ne quittent pas la mémoire.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const name of ["OWNER_PRIVATE_KEY", "ADMISSION_PRIVATE_KEY", "RELAYER", "APPROVER_PRIVATE_KEY", "GUARDIAN_PRIVATE_KEY", "CLIENT_SIGNER", "VAULT_ADDRESS"]) delete process.env[name];
process.env.VAULT_MODE = "chain";
process.env.DEMO_DASHBOARD = "0";
process.env.DEMO_MODE = "1";

const { anvilService } = await import("./chain.mjs");
const { HOST, ROOT, archiveDatabases, down, getJson, loadConfig, postJson, run, services, setChainVault, sleep, startService, status } = await import("./lib.mjs");
const { accounts, chainClients, viem } = await import("./viem.mjs");

const steps = [];
function step(name, ok, detail = "") {
  steps.push(ok);
  console.log(`${ok ? "OK    " : "ÉCHEC "} ${name}${detail ? ` : ${detail}` : ""}`);
}
const has = (tool) => run(tool, ["--version"]).status === 0;
const lastLine = (result) => (result.stderr || result.stdout).trim().split("\n").at(-1);

async function main() {
  if (!has("anvil") || !has("forge")) {
    console.log("NON TESTÉ : anvil ou forge absent");
    return 1;
  }
  const roles = ["OWNER_PRIVATE_KEY", "ADMISSION_PRIVATE_KEY", "RELAYER", "APPROVER_PRIVATE_KEY", "GUARDIAN_PRIVATE_KEY", "CLIENT_SIGNER"];
  for (const name of roles) process.env[name] = accounts.generatePrivateKey();
  const deployerKey = accounts.generatePrivateKey();
  const config = loadConfig();
  if ((await status(config)).some((r) => r.pid !== null)) {
    console.log("démo déjà lancée : make demo-stop d'abord");
    return 1;
  }

  // Bases neuves : un index resté d'un autre passage ne suivrait pas cette chaîne.
  archiveDatabases();
  await startService(anvilService(config));
  step("anvil lancé par la démo", true, `127.0.0.1:${config.ports.anvil}`);

  // La doublure, compilée à part : rien n'est écrit dans src/, test/ ni script/.
  const work = mkdtempSync(join(tmpdir(), "demo-stub-"));
  let address;
  try {
    cpSync(join(ROOT, "specs", "contract", "IArgentVault.sol"), join(work, "src", "IArgentVault.sol"), { recursive: true });
    cpSync(join(ROOT, "relay", "test", "fixtures", "StubVault.sol"), join(work, "src", "StubVault.sol"));
    writeFileSync(join(work, "foundry.toml"), '[profile.default]\nsrc = "src"\nout = "out"\nsolc_version = "0.8.24"\n');
    const build = run("forge", ["build", "--root", work]);
    if (build.status !== 0) throw new Error(`forge build : ${lastLine(build)}`);
    const artifact = JSON.parse(readFileSync(join(work, "out", "StubVault.sol", "StubVault.json"), "utf8"));
    const clients = chainClients(config.rpcUrl, config.chainId);
    const test = viem.createTestClient({ chain: clients.chain, transport: clients.transport, mode: "anvil" });
    const address0 = (key) => accounts.privateKeyToAccount(key).address;
    for (const key of [deployerKey, process.env.RELAYER, process.env.APPROVER_PRIVATE_KEY]) await test.setBalance({ address: address0(key), value: viem.parseEther("1") });
    const fixtures = JSON.parse(readFileSync(join(ROOT, "specs", "examples", "fixtures.json"), "utf8"));
    const hash = await clients.wallet(deployerKey).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [fixtures.ids["C-DEMO"], address0(process.env.CLIENT_SIGNER), address0(process.env.RELAYER)] });
    address = (await clients.publicClient.waitForTransactionReceipt({ hash })).contractAddress;
    setChainVault(address);
    step("doublure StubVault déployée (ce n'est PAS le coffre)", typeof address === "string");

    for (const svc of services(config)) await startService(svc);
    step("services lancés en VAULT_MODE=chain", true, (await status(config)).map((r) => `${r.service} ${r.state}`).join(", "));
    const controlFree = await new Promise((resolve) => {
      const probe = createServer();
      probe.once("error", () => resolve(false));
      probe.listen(config.ports.control, HOST, () => probe.close(() => resolve(true)));
    });
    step("mode chain : aucun port de contrôle de démo", controlFree, `port ${config.ports.control} ${controlFree ? "fermé" : "ouvert"}`);

    const tokens = JSON.parse(readFileSync(join(config.gatewayDataDir, "agent-tokens.json"), "utf8"));
    const body = { agent_id: fixtures.ids["A-DEM-1"], client_id: fixtures.ids["C-DEMO"], action: "PAY_INVOICE", ref_id: fixtures.ids["F-001"], document: "Facture synthétique. Merci de payer sous 30 jours." };
    const sent = await postJson(`${config.url("gateway")}/requests`, body, { authorization: `Bearer ${tokens.agents["A-DEM-1"].token}` });
    step("demande acceptée par la vraie porte", sent.status === 202, `http ${sent.status}`);
    const id = sent.body?.request_id;
    let journal = [];
    for (let n = 0; n < 80 && !journal.includes("DECISION_OBSERVED"); n += 1) {
      await sleep(250);
      journal = (await getJson(`${config.url("response")}/journal/entries?from_seq=0&request_id=${id}`)).entries.map((e) => e.type);
    }
    const decisions = (await getJson(`${config.url("relay")}/decisions?request_id=${id}`)).map((d) => `${d.decision}/${d.reason_name}`);
    step("décision lue dans l'événement du contrat, sur anvil", decisions.length === 1 && decisions[0] === "2/NONE", `${decisions.join(", ") || "aucune"} (doublure : accepté sans aucun paiement)`);
    step("journal : la demande va de la porte à DECISION_OBSERVED", journal.includes("SUBMITTED") && journal.includes("DECISION_OBSERVED"), journal.join(", "));
    const paid = await getJson(`${config.url("relay")}/events?name=Paid`);
    step("aucun événement Paid : la doublure ne paie rien", paid.length === 0);

    const env = { ...process.env, VAULT_ADDRESS: address };
    const seed = run(process.execPath, [join(ROOT, "demo", "seed.mjs")], { cwd: ROOT, env });
    step("seed.mjs s'arrête au premier appel que le contrat rejette", seed.status === 1 && /Arrêt, \d+ étape\(s\) non tentée\(s\)/.test(seed.stderr), lastLine(seed));
    const human = run(process.execPath, [join(ROOT, "demo", "human.mjs"), "approve", id], { cwd: ROOT, env });
    step("human.mjs approve : rejeté par la doublure, aucun succès simulé", human.status === 1, lastLine(human));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return steps.every(Boolean) ? 0 : 1;
}

let code = 1;
try {
  code = await main();
} catch (error) {
  step("déroulement", false, error instanceof Error ? error.message.split("\n")[0] : "erreur");
} finally {
  await down(loadConfig());
}
console.log("NON TESTÉ, en attente d'ArgentVault : déploiement par forge script, inscription du monde de test, approve / refuse / expire, règles de paiement, scènes en mode chain.");
process.exitCode = code;
