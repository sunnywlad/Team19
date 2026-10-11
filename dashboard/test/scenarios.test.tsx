// Un test de rendu par scénario de specs/acceptance/scenarios.md : la décision,
// son motif, la réaction déclenchée, tels que le jury doit les lire.
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderScenario, startOfScript, text } from "./helpers.tsx";

const decisions = async (): Promise<string[]> => (await screen.findAllByTestId("decision")).map(text);
const offContract = async (): Promise<string[]> => (await screen.findAllByTestId("hors-contrat")).map(text);
const value = async (testId: string): Promise<string> => text(await screen.findByTestId(testId));
/** Une ligne de tableau, cellules séparées par « | ». */
const cells = async (testId: string): Promise<string> => [...(await screen.findByTestId(testId)).children].map(text).join(" | ");

describe("les huit scénarios", () => {
  it("1. facture légitime : acceptée et payée, 10, plaçable 20, aucune réponse", async () => {
    renderScenario("1");
    const [row] = await decisions();
    expect(row).toMatch(/^Accepté/);
    expect(row).toContain("acceptée et payée");
    expect(row).toContain("10 u payé");
    expect(row).toContain("aucune (journal seul)");
    expect(await value("placable")).toBe("20 u");
    expect(await value("cash")).toBe("90 u");
    expect(await value("dettes")).toBe("30 u");
    expect(await screen.findByText("Aucun incident : aucun délai à mesurer.")).toBeTruthy();
  });

  it("2. agent non reconnu : rejetée à l'entrée, contrat non atteint, aucune réponse", async () => {
    renderScenario("2");
    const [line] = await offContract();
    expect(line).toContain("rejetée à l'entrée");
    expect(line).toContain("jeton expiré");
    expect(line).toContain("agent non authentifié");
    expect(line).toContain("aucune (journal seul)");
    expect(await screen.findByText("Aucune décision du contrat pour l'instant.")).toBeTruthy();
    expect(screen.queryAllByTestId("decision")).toHaveLength(0);
  });

  it("3. facture piégée détectée : bloquée à la porte d'entrée, code affiché, réponse complète, trois délais", async () => {
    renderScenario("3");
    const [line] = await offContract();
    expect(line).toContain("bloquée à la porte d'entrée");
    expect(line).toContain("instruction dans une donnée (INSTRUCTION_IN_DATA)");
    expect(line).toContain("score 93 pour un seuil de 70");
    expect(line).toContain("quarantaine, pause de l'agent (hors chaîne), alerte, pause de l'agent (sur la chaîne), rapport d'incident");
    expect(screen.queryAllByTestId("decision")).toHaveLength(0);
    expect(await cells("delai-arrivee-detection")).toBe("Arrivée → détection | 41 ms | horloge : journal");
    expect(await cells("delai-detection-pause")).toBe("Détection → pause | 11 ms | horloge : journal");
    expect(await cells("delai-detection-alerte")).toBe("Détection → alerte | 20 ms | horloge : journal");
  });

  it("4. facture piégée non détectée : refusée par le contrat, facture inconnue, même réponse", async () => {
    renderScenario("4");
    const [row] = await decisions();
    expect(row).toMatch(/^Refusé/);
    expect(row).toContain("refusée par le contrat : facture inconnue");
    expect(row).toContain("aucun montant sorti");
    expect(row).toContain("quarantaine, pause de l'agent (hors chaîne), alerte");
    expect(await value("cash")).toBe("100 u");
    // Détection par le contrat : l'heure de détection est celle du bloc. On ne la soustrait pas à une heure du journal.
    expect(await value("delai-arrivee-detection")).toContain("non calculé : horloges différentes (journal → bloc)");
    expect(await value("delai-detection-pause")).toContain("non calculé : horloges différentes (bloc → journal)");
    expect(await cells("delai-observation-pause")).toBe("Lecture de la décision → pause | 11 ms | horloge : journal");
    expect(await cells("delai-decision-pause-chaine")).toMatch(/^Décision → pause sur la chaîne \| [67] s \| horloge : bloc$/);
  });

  it("5. relais en panne : en file, bandeau, alerte de disponibilité, puis expirée en file", async () => {
    const t0 = startOfScript();
    const first = renderScenario("5", { t0, now: t0 + 20_000 });
    const [waiting] = await offContract();
    expect(waiting).toContain("en file");
    expect(waiting).toContain("alerte de disponibilité");
    expect(text(await screen.findByText("Relais indisponible"))).toBe("Relais indisponible");
    expect(screen.queryAllByTestId("decision")).toHaveLength(0);
    first.unmount();

    renderScenario("5", { t0 });
    const [expired] = await offContract();
    expect(expired).toContain("expirée en file");
    expect(await value("cash")).toBe("100 u");
  });

  it("6. au-dessus du seuil : validation humaine, 30 bloqué, notification à l'approbateur, plaçable inchangé", async () => {
    renderScenario("6");
    const [row] = await decisions();
    expect(row).toMatch(/^Validation humaine/);
    expect(row).toContain("en attente d'approbation");
    expect(row).toContain("30 u bloqué");
    expect(row).toContain("notification à l'approbateur");
    expect(await value("bloque")).toBe("30 u");
    expect(await value("dettes")).toBe("40 u");
    expect(await value("placable")).toBe("20 u");
  });

  it("7. placement trop élevé : refusée, dépasse le plaçable, plaçable 20 affiché, journal seul", async () => {
    renderScenario("7");
    const [row] = await decisions();
    expect(row).toMatch(/^Refusé/);
    expect(row).toContain("refusée par le contrat : dépasse le plaçable");
    expect(row).toContain("placement");
    expect(row).toContain("aucune (journal seul)");
    expect(await value("placable")).toBe("20 u");
  });

  it("8. rejeu et double paiement : demande rejouée, facture déjà payée, cash inchangé", async () => {
    renderScenario("8");
    const rows = await decisions();
    expect(rows).toHaveLength(3);
    // Les plus récentes d'abord : 8 b, 8 a, puis le paiement d'origine.
    expect(rows[0]).toContain("refusée par le contrat : facture déjà payée");
    expect(rows[1]).toContain("refusée par le contrat : demande rejouée");
    expect(rows[2]).toContain("acceptée et payée");
    for (const row of rows.slice(0, 2)) {
      expect(row).toMatch(/^Refusé/);
      expect(row).toContain("aucun montant sorti");
      expect(row).toContain("aucune (journal seul)");
    }
    expect(await value("cash")).toBe("90 u");
  });

  it("chaque décision est donnée en mots avec une icône, pas seulement en couleur", async () => {
    renderScenario("8");
    const rows = await screen.findAllByTestId("decision");
    for (const row of rows) {
      const badge = row.querySelector(".decision");
      expect(badge?.querySelector("svg")).not.toBeNull();
      expect(text(badge as Element)).toMatch(/^(Refusé|Validation humaine|Accepté)$/);
    }
    expect(within(rows[0] as HTMLElement).getByText("Refusé")).toBeTruthy();
  });
});
