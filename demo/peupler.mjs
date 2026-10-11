// Peuple la démo pour le dashboard : les demandes des scènes, jouées à la suite
// par la VRAIE porte d'entrée, sans remise à zéro entre elles.
//
//   DEMO_MODE=1 node demo/peupler.mjs      (make demo-peupler, après make demo)
//
// Rien n'est écrit à la main dans le journal, la file ou le coffre : chaque
// ligne que le dashboard affiche ensuite vient d'une demande réellement passée
// par la porte, l'IA du client, le relais et le coffre. Le script ne compare à
// aucune attente (c'est le rôle de « make scenes ») : il affiche ce que les
// services ont fait, étape par étape, puis l'état final.
//
// Il commence par la remise à zéro de la démo (lib.mjs, reset : tout est
// archivé), pour que deux passages donnent le même écran. La dernière étape
// laisse une demande en validation humaine : son délai est celui du coffre
// (30 s dans le monde de test). Passé ce délai, personne n'ayant répondu, le
// dashboard l'affiche « échéance dépassée ».
import { fileURLToPath } from "node:url";
import { bringUpChain } from "./chain.mjs";
import { DemoError, reset, sleep, status } from "./lib.mjs";
import { INVOICE, PLACEMENT, config, decisions, incidents, journalLabels, missedDocument, output, paid, paused, send, show, trappedDocument, until, vault } from "./scenes.mjs";

const BAD_TOKEN = "jeton-absent-du-registre";
const decided = (seen) => seen.some((l) => l.startsWith("DECISION_OBSERVED"));
const has = (wanted) => (seen) => seen.includes(wanted);

// [ce qui est montré, envoi, fin attendue dans le journal de la demande]
const STEPS = [
  ["facture légitime F-001", () => send("A-DEM-1", "PAY_INVOICE", "F-001", INVOICE), decided],
  ["jeton inconnu, 1 sur 3", () => send("A-DEM-1", "PAY_INVOICE", "F-001", INVOICE, BAD_TOKEN), has("AUTH_REJECTED")],
  ["jeton inconnu, 2 sur 3", () => send("A-DEM-1", "PAY_INVOICE", "F-001", INVOICE, BAD_TOKEN), has("AUTH_REJECTED")],
  ["jeton inconnu, 3 sur 3", () => send("A-DEM-1", "PAY_INVOICE", "F-001", INVOICE, BAD_TOKEN), has("AUTH_REJECTED")],
  ["facture piégée, détectée", () => send("A-DEM-2", "PAY_INVOICE", "F-001", trappedDocument()), has("INCIDENT_REPORT_GENERATED")],
  ["facture piégée, non détectée, F-999 inconnue", () => send("A-DEM-3", "PAY_INVOICE", "F-999", missedDocument()), has("INCIDENT_REPORT_GENERATED")],
  ["placement P-030, au-dessus du plaçable", () => send("A-TRESO", "PLACE", "P-030", PLACEMENT), decided],
  ["placement P-020, dans la limite", () => send("A-TRESO", "PLACE", "P-020", PLACEMENT), decided],
  ["F-001 demandée une seconde fois", () => send("A-DEM-1", "PAY_INVOICE", "F-001", INVOICE), (seen) => decided(seen) || seen.includes("QUARANTINED")],
  ["facture F-002, au-dessus du seuil", () => send("A-DEM-1", "PAY_INVOICE", "F-002", INVOICE), has("ALERT_SENT(APPROVAL_REQUESTED)")],
];

/** Ce que les services ont fait d'une demande : porte, contrat, paiement, réactions. */
async function observed(sent) {
  if (sent.id === undefined) return `porte ${sent.http}, sans identifiant de demande`;
  const out = await output(sent.id);
  const seen = await journalLabels(sent.id);
  const reactions = seen.filter((l) => l.startsWith("AGENT_PAUSED") || l.startsWith("ALERT_SENT") || l === "INCIDENT_REPORT_GENERATED");
  const parts = [`porte ${sent.http} ${out?.verdict ?? "?"}${out?.reason_codes?.length ? ` (${out.reason_codes.join(", ")})` : ""}`];
  const contract = await decisions(sent.id);
  parts.push(`contrat ${contract.length === 0 ? "non atteint" : contract.join(" puis ")}`);
  const payments = await paid(sent.id);
  if (payments.length > 0) parts.push(`payé ${show(payments)}`);
  if (reactions.length > 0) parts.push(`réponse ${show(reactions)}`);
  return parts.join(" · ");
}

async function main() {
  if (process.env.DEMO_MODE !== "1") throw new DemoError("le peuplement remet la démo à zéro : DEMO_MODE=1 exigé (make demo-peupler)");
  const down = (await status(config)).filter((row) => row.service !== "dashboard" && row.state !== "prêt" && row.state !== "ouvert" && row.state !== "lancé");
  if (down.length > 0) throw new DemoError(`services non prêts (${down.map((row) => row.service).join(", ")}) : make demo d'abord`);

  console.log(`peuplement : VAULT_MODE=${config.mode}${config.mode === "fake" ? " — COFFRE SIMULÉ : aucun fonds, aucune chaîne" : ""}, détecteur réel, journal réel`);
  await reset(config, { chain: (c) => bringUpChain(c, { fresh: true }), quiet: true });

  for (const [n, [what, play, done]] of STEPS.entries()) {
    const sent = await play();
    if (sent.id !== undefined) {
      await until(() => journalLabels(sent.id), done);
      // Temps de repos : les réactions du service de réponse suivent la décision.
      await sleep(1500);
    }
    console.log(`  ${String(n + 1).padStart(2)}/${STEPS.length} ${what} : ${await observed(sent)}`);
  }

  console.log(`\nétat du coffre : ${show(await vault())}`);
  console.log(`paiements : ${show(await paid())}`);
  console.log(`agents en pause : ${show(await paused())}`);
  console.log(`incidents : ${show(await incidents())}`);
  if (config.dashboard) console.log(`dashboard : ${config.url("dashboard")}`);
  console.log("la demande F-002 attend une validation humaine jusqu'à l'échéance du coffre ; relancer « make demo-peupler » pour la revoir en attente");
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (!(error instanceof DemoError)) throw error;
    console.error(`peuplement : ${error.message}`);
    process.exitCode = 1;
  }
}
