// Remise à zéro entre deux passages de la démo.
//
//   DEMO_MODE=1 npm run demo:reset
//
// Demande au service de réponse d'ARCHIVER le journal et les rapports
// (journal.jsonl.<horodatage>.bak, tête de chaîne sauvegardée à côté) puis de
// repartir d'une chaîne neuve. Demande ensuite à la porte d'entrée d'émettre de
// nouveaux jetons d'agents.
//
// Rien n'est effacé. La commande ne fait rien sans DEMO_MODE=1, et le service
// refuse lui aussi s'il n'a pas été lancé avec DEMO_MODE=1 : un journal que
// n'importe quel appel peut vider ne prouverait plus rien.
//
//   JOURNAL_URL   service de réponse (défaut : http://127.0.0.1:8790)
//   GATEWAY_URL   porte d'entrée (défaut : http://127.0.0.1:8780)

async function post(url: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  if (process.env["DEMO_MODE"] !== "1") {
    console.error("demo:reset ne s'exécute qu'avec DEMO_MODE=1");
    return 64;
  }
  const journalUrl = (process.env["JOURNAL_URL"] || "http://127.0.0.1:8790").replace(/\/+$/, "");
  const gatewayUrl = (process.env["GATEWAY_URL"] || "http://127.0.0.1:8780").replace(/\/+$/, "");

  const journal = await post(`${journalUrl}/demo/reset`);
  if (journal === null) {
    console.error("service de réponse injoignable : rien n'a été archivé");
    return 1;
  }
  if (journal.status !== 200) {
    console.error(`service de réponse : refus (${journal.status}). Est-il lancé avec DEMO_MODE=1 ?`);
    return 1;
  }
  const result = journal.body as { archived_journal: string; archived_head: { count: number; hash: string }; archived_reports: string | null };
  console.log(`journal archivé : ${result.archived_journal}`);
  console.log(`  ${result.archived_head.count} entrées, tête ${result.archived_head.hash}`);
  console.log(`rapports archivés : ${result.archived_reports ?? "aucun"}`);

  const gateway = await post(`${gatewayUrl}/demo/reissue-tokens`);
  if (gateway === null) {
    console.error("porte d'entrée injoignable : jetons non réémis");
    return 1;
  }
  if (gateway.status !== 200) {
    console.error(`porte d'entrée : refus (${gateway.status}). Est-elle lancée avec DEMO_MODE=1 ?`);
    return 1;
  }
  const reissued = gateway.body as { agents: number };
  console.log(`jetons réémis : ${reissued.agents} agents`);
  return 0;
}

process.exitCode = await main();
