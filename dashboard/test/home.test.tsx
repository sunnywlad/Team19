// Accueil : bandeau d'état, action humaine requise, incidents ouverts. Chaque
// valeur est lue, jamais inventée ; une valeur illisible dit « Non mesuré ».
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RelayEvent } from "../src/api/types.ts";
import { paidTotal, pauseCount } from "../src/domain/cockpit.ts";
import { renderScenario, text } from "./helpers.tsx";

const value = async (testId: string): Promise<string> => text(await screen.findByTestId(testId));
type Row = Record<string, unknown>;
/** Une case du bandeau : libellé, valeur, mot d'état, note, séparés par une espace. */
const cell = async (testId: string): Promise<string> => [...(await screen.findByTestId(testId)).querySelectorAll("dt, dd")].map(text).join(" ");

describe("bandeau d'état", () => {
  it("scénario 1 : 10 sortis, rien de bloqué, aucun agent en pause, coffre ouvert", async () => {
    renderScenario("1");
    await screen.findAllByTestId("decision");
    expect(await cell("etat-sorti")).toMatch(/^Montant sorti 10 u payé 1 paiement \(événements Paid\)/);
    expect(screen.getByTestId("etat-sorti").getAttribute("data-ton")).toBe("sain");
    expect(await cell("etat-bloque")).toMatch(/^Montant bloqué 0 u aucun/);
    expect(await cell("etat-pauses")).toMatch(/^Agents en pause 0 aucun 0 hors chaîne · 0 sur la chaîne/);
    expect(await cell("etat-coffre")).toMatch(/^Coffre Ouvert pas en pause/);
  });

  it("scénario 6 : 30 bloqués, en attente d'un humain", async () => {
    renderScenario("6");
    await screen.findAllByTestId("decision");
    expect(await cell("etat-bloque")).toMatch(/^Montant bloqué 30 u attend un humain/);
    expect(screen.getByTestId("etat-bloque").getAttribute("data-ton")).toBe("attente");
    expect(await cell("etat-sorti")).toMatch(/^Montant sorti 0 u rien n'est sorti/);
  });

  it("scénario 3 : l'agent piégé est en pause, hors chaîne puis sur la chaîne", async () => {
    renderScenario("3");
    await screen.findAllByTestId("hors-contrat");
    expect(await cell("etat-pauses")).toMatch(/^Agents en pause 2 écartés 1 hors chaîne · 1 sur la chaîne/);
    expect(screen.getByTestId("etat-pauses").getAttribute("data-ton")).toBe("veto");
  });

  it("vue du coffre illisible : « Non mesuré », jamais « Ouvert » ni 0", async () => {
    renderScenario("1", { tamper: (path, body) => (path === "/vault" ? { ...(body as Row), vault_paused: null, total_held_wei: null } : body) });
    await screen.findAllByTestId("decision");
    expect(await cell("etat-coffre")).toMatch(/^Coffre Non mesuré non mesuré/);
    expect(await cell("etat-bloque")).toMatch(/^Montant bloqué Non mesuré non mesuré/);
  });

  it("montant sorti : somme des Paid lus, et « Non mesuré » si la lecture est tronquée", () => {
    const paid = (amount: unknown): RelayEvent => ({
      id: 1, name: "Paid", tx_hash: "0x", log_index: 0, block_number: 1, block_timestamp: 1, request_id: null, args: { amount: amount as string },
    });
    expect(paidTotal([paid("10"), paid("5"), paid("x"), { ...paid("7"), name: "HoldPlaced" }], false)).toEqual({ wei: "15", payments: 2 });
    expect(paidTotal([paid("10")], true)).toBeNull();
    expect(pauseCount(null, null)).toEqual({ offchain: null, onchain: null });
  });
});

describe("action humaine requise", () => {
  it("scénario 6 : un cas, compte à rebours depuis l'échéance, et rien qui approuve", async () => {
    renderScenario("6");
    const [row] = await screen.findAllByTestId("action-humaine-cas");
    expect(text(row as Element)).toContain("30 u");
    expect(text(row as Element)).toContain("0x6fc1…0db1");
    expect(await value("action-humaine-reste")).toMatch(/^2\d s$/);
    expect(screen.getByRole("heading", { name: "Action humaine requise · 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir Validation" }));
    expect(await screen.findByRole("button", { name: "Validation", current: "page" })).toBeTruthy();
  });

  it("sans cas en attente : la section le dit, sans réclamer d'attention", async () => {
    renderScenario("1");
    expect(await value("action-humaine-vide")).toBe("Aucune demande n'attend un humain.");
    expect(document.querySelector(".action-humaine-requise")).toBeNull();
  });
});

describe("incidents ouverts", () => {
  it("scénario 4 : l'incident ouvert mène à son rapport", async () => {
    renderScenario("4");
    expect(await value("accueil-incidents-ouverts")).toBe("1");
    const [line] = await screen.findAllByTestId("accueil-incident");
    expect(text(line as Element)).toContain("refus du contrat");
    fireEvent.click(screen.getByRole("button", { name: /^Rapport/ }));
    expect(await screen.findByRole("button", { name: "Alertes et rapports", current: "page" })).toBeTruthy();
    expect(await value("etat-incident")).toBe("ouvert");
  });
});
