// Dérivations de la console : chaque chiffre de la vue d'ensemble, l'agrégat
// par jour, les cas en attente et leurs contrôles, les référentiels. Calculés
// sur le monde des fixtures, servi comme le serviraient le relais et le service
// de réponse.
import { describe, expect, it } from "vitest";
import { buildWorld, type ScenarioName } from "../fixtures/scenarios.ts";
import { IDS, toDecisions, units } from "../fixtures/sim.ts";
import type { RelayDecision, RelayEvent } from "../src/api/types.ts";
import { pendingCases } from "../src/domain/activity.ts";
import {
  blockedRequests,
  blockedSummary,
  chartMax,
  decisionsByDay,
  interventionShare,
  paidSummary,
  pendingSummary,
  registeredAmount,
} from "../src/domain/apercu.ts";
import { TRIGGER_SEVERITY } from "../src/domain/labels.ts";
import { agentRows, beneficiaryRows, formatDelay, mandateWords, rulesOf } from "../src/domain/referentiels.ts";
import { closedCases, controlsFor, formatCountdown, historyFor, openCases, remainingS } from "../src/domain/validation.ts";

const world = (name: ScenarioName, t0 = Date.now() - 60_000) => {
  const w = buildWorld(name, t0);
  return { ...w, decisions: toDecisions(w.events) };
};
const fmt = (wei: string | null): string => (wei === null ? "non disponible" : `${BigInt(wei) / 10n ** 15n} u`);

describe("vue d'ensemble : chiffres", () => {
  it("paiements exécutés : nombre et somme des Paid", () => {
    expect(paidSummary(world("1").events)).toEqual({ count: 1, knownWei: units(10), unknown: 0 });
    expect(paidSummary(world("6a").events)).toEqual({ count: 1, knownWei: units(30), unknown: 0 });
    expect(paidSummary(world("2").events)).toEqual({ count: 0, knownWei: "0", unknown: 0 });
  });

  it("un montant payé illisible n'entre pas dans la somme : il est compté à part", () => {
    const events: RelayEvent[] = world("1").events.map((e) => (e.name === "Paid" ? { ...e, args: { ...e.args, amount: "1e18" } } : e));
    expect(paidSummary(events)).toEqual({ count: 1, knownWei: "0", unknown: 1 });
  });

  it("part sans intervention : NONE contre APPROVED ; aucun paiement : pas de part", () => {
    expect(interventionShare(world("1").decisions)).toEqual({ auto: 1, approved: 0, share: 1 });
    expect(interventionShare(world("6a").decisions)).toEqual({ auto: 0, approved: 1, share: 0 });
    expect(interventionShare(world("4").decisions).share).toBeNull();
  });

  it("une décision 2 au motif incohérent n'est pas un paiement", () => {
    const [d] = world("1").decisions as [RelayDecision];
    expect(interventionShare([{ ...d, reason: 1 }]).share).toBeNull();
  });

  it("à valider : cas ouverts et montant bloqué", () => {
    const w = world("6");
    expect(pendingSummary(pendingCases(w.decisions, w.events))).toEqual({ count: 1, knownWei: units(30), unknown: 0 });
    const closed = world("6a");
    expect(pendingSummary(pendingCases(closed.decisions, closed.events)).count).toBe(0);
  });

  it("bloqués par une règle : refus du contrat et blocages à la porte ; référence inconnue : montant inconnu, jamais 0", () => {
    const s4 = world("4");
    const refused = blockedRequests(s4.decisions, s4.events, s4.journal, true);
    // Scénario 4 : F-999 n'est pas inscrite.
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ origin: "contrat", refId: IDS["F-999"], amountWei: null });
    expect(blockedSummary(refused)).toEqual({ count: 1, knownWei: "0", unknown: 1 });

    const s3 = world("3");
    const gate = blockedRequests(s3.decisions, s3.events, s3.journal, true);
    // Scénario 3 : bloquée avant REQUEST_PARSED, la référence n'est pas connue du journal.
    expect(gate).toHaveLength(1);
    expect(gate[0]).toMatchObject({ origin: "porte", amountWei: null });
  });

  it("refus d'une référence inscrite : montant inscrit ; refus d'un approbateur : pas une règle", () => {
    const s8 = world("8");
    const blocked = blockedRequests(s8.decisions, s8.events, s8.journal, true);
    expect(blocked.map((b) => b.amountWei)).toEqual([units(10), units(10)]);
    expect(blockedSummary(blocked)).toEqual({ count: 2, knownWei: units(20), unknown: 0 });

    const s6b = world("6b");
    const refusedByHuman = s6b.decisions.map((d) => (d.reason === 11 ? { ...d, reason: 12, reason_name: "APPROVAL_REFUSED" } : d));
    expect(blockedRequests(refusedByHuman, s6b.events, null, true)).toHaveLength(0);
    // Délai dépassé : une règle (le délai), compté.
    expect(blockedRequests(s6b.decisions, s6b.events, null, true)).toHaveLength(1);
  });

  it("porte : la référence vient de REQUEST_PARSED, seulement si le journal est du même monde", () => {
    const s4 = world("4");
    const journal = s4.journal.map((e) => (e.type === "DETECTION" ? { ...e, data: { ...e.data, verdict: "BLOCK" } } : e));
    const gate = blockedRequests([], buildWorld("1", Date.now()).events, journal, true);
    expect(gate[0]).toMatchObject({ origin: "porte", refId: IDS["F-999"], amountWei: null });
    const s1 = world("1");
    const j1 = s1.journal.map((e) => (e.type === "DETECTION" ? { ...e, data: { ...e.data, verdict: "BLOCK" } } : e));
    expect(blockedRequests([], s1.events, j1, true)[0]?.amountWei).toBe(units(10));
    expect(blockedRequests([], s1.events, j1, false)[0]?.amountWei).toBeNull();
    expect(registeredAmount(null, s1.events)).toBeNull();
  });
});

describe("vue d'ensemble : décisions par jour", () => {
  const now = new Date(2026, 9, 18, 15, 0, 0).getTime();
  const at = (y: number, m: number, d: number, h = 12): number => Math.floor(new Date(y, m, d, h).getTime() / 1000);
  const base = world("1").decisions[0] as RelayDecision;
  const decision = (reason: number, decisionCode: number, ts: number, i: number): RelayDecision => ({
    ...base, id: i, log_index: i, decision: decisionCode, effective_decision: decisionCode, reason, block_timestamp: ts,
  });

  it("jours locaux, aujourd'hui compris ; un jour sans rien vaut zéro", () => {
    const decisions = [
      decision(0, 2, at(2026, 9, 18, 9), 1),
      decision(0, 2, at(2026, 9, 18, 10), 2),
      decision(13, 2, at(2026, 9, 17), 3),
      decision(0, 2, at(2026, 9, 1), 4),
    ];
    const blocked = [{ key: "x", origin: "porte" as const, requestId: null, agentId: null, refId: null, amountWei: null, atMs: new Date(2026, 9, 16, 23, 59).getTime() }];
    const days = decisionsByDay(decisions, blocked, now, 7);
    expect(days).toHaveLength(7);
    expect(days.at(-1)).toMatchObject({ auto: 2, approved: 0, blocked: 0, startMs: new Date(2026, 9, 18).getTime() });
    expect(days.at(-2)).toMatchObject({ auto: 0, approved: 1, blocked: 0 });
    expect(days.at(-3)).toMatchObject({ auto: 0, approved: 0, blocked: 1 });
    // Le 1er octobre est hors de la fenêtre de 7 jours.
    expect(days.reduce((n, d) => n + d.auto, 0)).toBe(2);
    expect(decisionsByDay(decisions, blocked, now, 30).reduce((n, d) => n + d.auto, 0)).toBe(3);
  });

  it("une décision illisible n'est comptée nulle part ; l'échelle a au moins 4 graduations", () => {
    const days = decisionsByDay([decision(1, 2, at(2026, 9, 18), 1)], [], now, 7);
    expect(days.every((d) => d.auto + d.approved + d.blocked === 0)).toBe(true);
    expect(chartMax(days)).toBe(4);
    expect(chartMax([{ startMs: 0, auto: 37, approved: 3, blocked: 2 }])).toBe(50);
  });
});

describe("à valider : cas, contrôles, historique", () => {
  it("cas ouvert, puis validé, rejeté ou expiré selon la clôture", () => {
    const w = world("6");
    const [open] = openCases(w.decisions, w.events);
    expect(open).toMatchObject({ refId: IDS["F-002"], amountWei: units(30), agentId: IDS["A-DEM-1"], beneficiaryId: IDS["B-002"] });
    expect(closedCases(w.decisions, w.events)).toEqual([]);
    expect(closedCases(world("6a").decisions, world("6a").events).map((c) => [c.state, c.amountWei])).toEqual([["valide", units(30)]]);
    expect(closedCases(world("6b").decisions, world("6b").events).map((c) => c.state)).toEqual(["expire"]);
  });

  it("contrôles dérivés des motifs du contrat et de DETECTION ; le seuil est la raison de l'attente", () => {
    const w = world("6");
    const [open] = openCases(w.decisions, w.events);
    const controls = controlsFor(open!, w.events, w.journal, fmt);
    expect(controls.map((c) => [c.key, c.state])).toEqual([
      ["reference", "ok"],
      ["beneficiaire", "ok"],
      ["agent", "ok"],
      ["seuil", "attention"],
      ["entree", "ok"],
    ]);
    expect(controls.find((c) => c.key === "seuil")?.detail).toBe("30 u au-dessus du seuil de 25 u");
    expect(controls.find((c) => c.key === "entree")?.detail).toBe("laissée passer · score 6 pour un seuil de 70");
    expect(controls.find((c) => c.key === "reference")?.detail).toMatch(/^inscrite au bloc \d+, 30 u$/);
  });

  it("journal d'un autre monde : contrôle d'entrée inconnu, rien d'inventé", () => {
    const w = world("6");
    const [open] = openCases(w.decisions, w.events);
    const entry = controlsFor(open!, w.events, null, fmt).find((c) => c.key === "entree");
    expect(entry).toMatchObject({ state: "inconnu", detail: "non disponible : journal non lu ou d'un autre monde" });
  });

  it("historique : entrées du journal et décision du contrat, chacune avec son horloge", () => {
    const w = world("6");
    const [open] = openCases(w.decisions, w.events);
    const history = historyFor(open!.requestId, w.journal, w.decisions);
    expect(history[0]).toMatchObject({ label: "Demande reçue à la porte d'entrée", clock: "journal" });
    expect(history.some((h) => h.clock === "bloc" && h.label.startsWith("Renvoyée à un humain"))).toBe(true);
    expect(historyFor(open!.requestId, null, w.decisions)).toHaveLength(1);
  });

  it("échéance : temps restant sur l'horloge locale ; absente : null", () => {
    expect(remainingS(1_000_100, 1_000_000_000)).toBe(100);
    expect(remainingS(null, 1)).toBeNull();
    expect(formatCountdown(3 * 3600 + 7 * 60 + 12)).toBe("3 h 07");
    expect(formatCountdown(725)).toBe("12 min 05 s");
    expect(formatCountdown(-3)).toBe("0 s");
  });
});

describe("référentiels et règles", () => {
  it("agents : inscrits, mandat en mots, paiements, blocages et pauses", () => {
    const w = world("3");
    const rows = agentRows(w.events, w.decisions, w.pausedAgents, w.journal);
    const byId = new Map(rows.map((r) => [r.agentId, r]));
    expect(rows).toHaveLength(5);
    expect(byId.get(IDS["A-DEM-2"]!)).toMatchObject({ mandate: 1, blocked: 1, status: "pause-deux" });
    expect(byId.get(IDS["A-TRESO"]!)).toMatchObject({ mandate: 2, paid: 0, blocked: 0, status: "actif" });
    expect(mandateWords(1)).toEqual(["payer une facture"]);
    expect(mandateWords(3)).toEqual(["payer une facture", "placer"]);
    expect(mandateWords(0)).toEqual(["aucune action : lecture seule"]);
    expect(mandateWords(5)).toEqual(["payer une facture", "bits inconnus (4)"]);
    expect(mandateWords(null)).toEqual(["mandat non lu"]);
  });

  it("agents : sans service de réponse, la pause hors chaîne n'est pas lue", () => {
    const w = world("3");
    const row = agentRows(w.events, w.decisions, null, null).find((r) => r.agentId === IDS["A-DEM-2"]);
    expect(row).toMatchObject({ status: "pause-chaine", offchainKnown: false, blocked: 0 });
  });

  it("fournisseurs : inscriptions, factures et paiements qui les citent", () => {
    const rows = beneficiaryRows(world("1").events);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.beneficiaryId === IDS["B-001"])).toMatchObject({ invoices: 1, invoicedWei: units(10), paidCount: 1, paidWei: units(10), unknown: 0 });
    expect(rows.find((r) => r.beneficiaryId === IDS["B-PLACEMENT"])).toMatchObject({ invoices: 0, paidCount: 0 });
  });

  it("règles : seuil et réserve lus au coffre, délai de réponse lu dans les événements", () => {
    const w = world("1");
    const rules = rulesOf(w.vault, w.events);
    expect(rules).toMatchObject({ thresholdWei: units(25), safetyReserveWei: units(40), vaultPaused: false });
    expect(rules.approvalDelay?.value).toBe(30);
    expect(rules.thresholdChange?.value).toBe(units(25));
    expect(rulesOf(null, null)).toMatchObject({ thresholdWei: null, approvalDelay: null, vaultPaused: null });
    expect(formatDelay(30)).toBe("30 s");
    expect(formatDelay(14_400)).toBe("4 h");
    expect(formatDelay(5_400)).toBe("1 h 30 min");
  });

  it("gravité : dérivée du seul déclencheur", () => {
    expect(TRIGGER_SEVERITY.DETECTOR_SCORE).toBe("critique");
    expect(TRIGGER_SEVERITY.RATE_BURST).toBe("modere");
  });
});
