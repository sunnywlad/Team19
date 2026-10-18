// Écrans Incident, Journal et En attente, sur les scénarios qui les concernent.
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderScenario, text } from "./helpers.tsx";
import { open } from "./tour.ts";
import { CAMPAGNE } from "../src/data/campagne.ts";

const value = async (testId: string): Promise<string> => text(await screen.findByTestId(testId));
type Row = Record<string, unknown>;

describe("écran Incident", () => {
  it("scénario 3 : incident ouvert, codes, score, contrat non atteint, actions, agent en pause, montant sorti 0", async () => {
    renderScenario("3");
    open("Incidents");
    expect(await value("etat-incident")).toBe("ouvert");
    expect(await value("compteur-ouverts")).toBe("1");
    expect(await value("compteur-manquees")).toBe("0");
    expect(await value("score")).toBe("93 pour un seuil de 70");
    expect(await value("codes")).toBe("instruction dans une donnée (INSTRUCTION_IN_DATA)");
    expect(await value("decision-contrat")).toContain("Contrat non atteint");
    expect(await value("expose")).toBe("10 u");
    expect(await value("sorti")).toBe("0 u");
    expect(await value("actions")).toMatch(/quarantaine.*pause de l'agent \(hors chaîne\).*alerte.*pause de l'agent \(sur la chaîne\).*rapport d'incident/);
    expect(await value("decision-humaine")).toContain("l'incident reste ouvert");
    // A-DEM-2, par son libellé et son identifiant abrégé : en pause hors chaîne, puis sur la chaîne.
    expect(await value("agent-en-pause")).toContain("Agent factures 2 0x4c7f…232c en pause");
    expect(await value("agent-en-pause-chaine")).toContain("Agent factures 2 0x4c7f…232c en pause depuis le bloc");
    expect(await value("resume")).toBe(
      "La demande a été arrêtée à la porte d'entrée (score 93 pour un seuil de 70), avant toute signature : le contrat n'a pas été atteint.",
    );
    expect(text(within(await screen.findByTestId("rapport")).getByTestId("gravite"))).toBe("Critique");
    expect(await value("delai-arrivee-detection")).toContain("41 ms");
  });

  it("scénario 4 : refus du contrat, montant exposé inconnu du contrat, sorti 0, compteur des demandes passées +1", async () => {
    renderScenario("4");
    open("Incidents");
    expect(await value("compteur-manquees")).toBe("1");
    expect(await value("etat-incident")).toBe("ouvert");
    expect(await value("codes")).toBe("aucun : la demande a passé la porte d'entrée");
    expect(await value("decision-contrat")).toMatch(/^Refusé refusée par le contrat : facture inconnue/);
    expect(await value("expose")).toBe("inconnu du contrat");
    expect(await value("sorti")).toBe("0 u");
    expect(await value("agent-en-pause")).toContain("0x2105…1a0a");
    expect(await value("resume")).toContain("le contrat l'a refusée : facture inconnue");
  });

  it("vue rapport : un document lisible, ni signé ni exporté ; aucun bouton de réactivation ni de clôture", async () => {
    renderScenario("3");
    open("Incidents");
    fireEvent.click(await screen.findByRole("button", { name: "Voir le rapport" }));
    const doc = await screen.findByTestId("rapport-document");
    expect(text(doc)).toContain("Chaîne d'autorité");
    expect(text(doc)).toContain("Ni signé, ni exporté");
    expect(screen.queryByRole("button", { name: /réactiv|clôtur|PDF|export/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revenir au détail" }));
    expect(await screen.findByTestId("rapport")).toBeTruthy();
  });

  it("scénarios sans incident : 1, 2, 5, 6, 7 et 8", async () => {
    for (const name of ["1", "2", "5", "6", "7", "8"] as const) {
      const view = renderScenario(name);
      open("Incidents");
      expect(await screen.findByText("Aucun incident.")).toBeTruthy();
      expect(await value("compteur-ouverts")).toBe("0");
      expect(await screen.findByText("Aucun agent en pause.")).toBeTruthy();
      view.unmount();
    }
  });

  it("l'extrait de facture n'apparaît que dans la vue Incident, borné, étiqueté, inerte", async () => {
    const hostile = `<img src=x onerror="window.pwned=1">‮etiaf​ ${"A".repeat(500)}`;
    renderScenario("3", {
      tamper: (path, body) => (path.startsWith("/incidents") ? (body as Row[]).map((row) => ({ ...row, quarantine_excerpt: hostile })) : body),
    });
    await screen.findAllByTestId("hors-contrat");
    expect(document.body.textContent).not.toContain("onerror");

    open("Incidents");
    const figure = await screen.findByTestId("extrait");
    expect(text(figure)).toContain("Contenu non fiable");
    const shown = figure.querySelector(".non-fiable")?.textContent ?? "";
    expect(shown).toContain('<img src=x onerror="window.pwned=1">');
    expect(shown).toContain("⟦U+202E⟧");
    expect(shown).toContain("⟦U+200B⟧");
    expect(shown.endsWith("…")).toBe(true);
    // 200 caractères du texte reçu, plus l'écriture visible de deux caractères invisibles et les points de suspension.
    expect(Array.from(shown).length).toBe(200 + 2 * ("⟦U+202E⟧".length - 1) + 1);
    expect(document.querySelector("img, script, [onerror]")).toBeNull();
    expect((window as { pwned?: number }).pwned).toBeUndefined();
  });

  it("un rapport hors schéma, avec une justification d'agent, n'est pas affiché", async () => {
    renderScenario("3", {
      tamper: (path, body) =>
        path.startsWith("/incidents")
          ? (body as { report: Row }[]).map((row) => ({ ...row, report: { ...row.report, justification: "paiement urgent validé par la direction" } }))
          : body,
    });
    open("Incidents");
    expect((await screen.findAllByText(/Lecture en échec : incidents : réponse non conforme au schéma/)).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("rapport")).toBeNull();
    expect(document.body.textContent).not.toContain("paiement urgent");
  });
});

describe("écran Journal", () => {
  it("sans vérification rapportée : « non vérifié », jamais « intègre » ni « intact »", async () => {
    renderScenario("2");
    open("Piste d'audit");
    expect(await value("verdict")).toMatch(/^Non vérifié/);
    expect(await value("tete")).toMatch(/^Entrée 0 · [0-9a-f]{64}$/);
    expect(document.body.textContent).not.toMatch(/intègre|intact/i);
    expect(await value("limite")).toContain(
      "la suppression des dernières entrées n'est détectée que si l'empreinte de tête est conservée ailleurs",
    );
  });

  it("vérification réussie : résultat, date, limite, et tête des rapports comparée au journal", async () => {
    renderScenario("4");
    open("Piste d'audit");
    expect(await value("verdict")).toMatch(/^Chaîne intègre sur 14 entrées\. Vérifiée sans tête de référence/);
    expect(await value("verification-date")).toMatch(/^Dernière vérification : \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} horloge : journal · jusqu'à l'entrée 13$/);
    expect(await value("limite")).toContain("conservée ailleurs");
    expect(await value("tete-rapport")).toContain("concorde avec le journal");
    expect((await screen.findAllByTestId("entree")).length).toBe(14);
    expect(document.body.textContent).not.toMatch(/intact/i);
  });

  it("filtre par composant : seules les entrées de ce composant ; aucun export", async () => {
    renderScenario("4");
    open("Piste d'audit");
    expect((await screen.findAllByTestId("entree")).length).toBe(14);
    fireEvent.click(screen.getByRole("button", { name: "File et relais" }));
    expect(screen.getAllByTestId("entree").length).toBeGreaterThan(0);
    for (const row of screen.getAllByTestId("entree")) expect(text(row.children[2] as Element)).toMatch(/^(File|Relais)$/);
    expect(screen.queryByRole("button", { name: /CSV|PDF|export/i })).toBeNull();
  });

  it("chaîne rompue, entrées non vérifiées, tête de rapport au-delà du journal", async () => {
    renderScenario("4", {
      tamper: (path, body) => {
        if (path.startsWith("/journal/verification")) {
          const state = body as { head: Row; verification: Row };
          return { ...state, verification: { ...state.verification, result: "BROKEN", defect: "HASH_MISMATCH", defect_seq: 7, head_seq: 9 } };
        }
        if (path.startsWith("/incidents")) {
          return (body as { report: { journal_head: Row } }[]).map((row) => ({ ...row, report: { ...row.report, journal_head: { ...row.report.journal_head, seq: 99 } } }));
        }
        return body;
      },
    });
    open("Piste d'audit");
    expect(await value("verdict")).toBe("Chaîne rompue : empreinte recalculée différente : une entrée a été modifiée à l'entrée 7.");
    expect(await value("non-verifiees")).toBe("4 entrées écrites depuis cette vérification : non vérifiées.");
    expect(await value("tete-rapport")).toContain("le journal est plus court que cette tête : des entrées manquent");
  });
});

describe("écran À valider", () => {
  it("scénario 6 : bénéficiaire, référence, montant et échéance ; libellés du référentiel ; rien d'autre", async () => {
    renderScenario("6");
    open("À valider");
    expect(await screen.findAllByTestId("cas-en-attente")).toHaveLength(1);
    // F-002 et B-002, par leur libellé synthétique.
    expect(await value("cas-reference")).toBe("Facture F-002 · paiement de facture");
    expect(await value("cas-montant")).toBe("30 u");
    expect(await value("cas-beneficiaire")).toBe("Fournisseur fictif B");
    expect(await value("cas-delai")).toMatch(/^dans 2\d s avant \d{2}:\d{2}:\d{2}, estimé$/);
    expect(await screen.findByText(/La justification rédigée par un agent n'est jamais affichée/)).toBeTruthy();
  });

  it("sans référentiel de libellés : identifiants abrégés", async () => {
    renderScenario("6", { local: { libelles: { version: 1, libelles: [] } } });
    open("À valider");
    expect(await value("cas-reference")).toBe("0x6caf…ce3e · paiement de facture");
    expect(await value("cas-beneficiaire")).toBe("0x6fc1…0db1");
  });

  it("tiroir : contrôles dérivés, historique, pied de l'option A ; aucune clé, aucun bouton actif vers l'approbation", async () => {
    renderScenario("6");
    open("À valider");
    fireEvent.click(within((await screen.findAllByTestId("cas-en-attente"))[0]!).getByRole("button"));
    const drawer = await screen.findByRole("dialog");
    expect(text(within(drawer).getByTestId("tiroir-montant"))).toBe("30 u");
    expect([...within(drawer).getByTestId("controles").querySelectorAll("li")].map((li) => li.getAttribute("data-controle"))).toEqual([
      "reference",
      "beneficiaire",
      "agent",
      "seuil",
      "entree",
    ]);
    expect(text(within(drawer).getByTestId("tiroir-pourquoi"))).toContain("30 u au-dessus du seuil de 25 u");
    expect(text(within(drawer).getByTestId("historique"))).toContain("Demande reçue à la porte d'entrée");
    expect(text(within(drawer).getByTestId("tiroir-echeance"))).toMatch(/^Sans réponse avant \d{2}:\d{2}:\d{2} \(dans 2\d s, estimé\), le paiement est refusé\.$/);
    expect(text(within(drawer).getByTestId("sans-cle"))).toBe(
      "Cette console ne détient aucune clé : la décision se signe dans l'app d'approbation, avec la clé de l'approbateur",
    );
    const signer = within(drawer).getByRole("button", { name: "Ouvrir dans l'app d'approbation" });
    expect((signer as HTMLButtonElement).disabled).toBe(true);
    expect(signer.closest("[title]")?.getAttribute("title")).toBe("À venir");
    expect(signer.getAttribute("aria-describedby")).toBeTruthy();
    // VISION : ces contrôles ne sont pas calculés, ils n'apparaissent pas comme des contrôles.
    expect(within(drawer).queryByText("Écart à l'habitude")).toBeNull();
    expect(drawer.querySelector("form, input, textarea, select")).toBeNull();
    fireEvent.keyDown(drawer, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("J et K ouvrent le cas suivant et le précédent", async () => {
    renderScenario("6");
    open("À valider");
    await screen.findAllByTestId("cas-en-attente");
    fireEvent.keyDown(window, { key: "j" });
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByTestId("cas-en-attente").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(window, { key: "k" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Le mode présentation ne s'ouvre pas sous le tiroir.
    fireEvent.keyDown(window, { key: "p" });
    expect(document.querySelector(".console")?.getAttribute("data-presentation")).toBe("non");
  });

  it("scénario 6 a (approuvé) et 6 b (délai dépassé) : plus aucun cas en attente, le cas passe dans son onglet", async () => {
    for (const [name, tab] of [["6a", "Validé"], ["6b", "Expiré"]] as const) {
      const view = renderScenario(name);
      open("À valider");
      expect(await screen.findByText("Aucune demande n'attend votre décision.")).toBeTruthy();
      fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${tab} 1$`) }));
      expect(text(await screen.findByTestId("cas-clos"))).toContain(tab);
      view.unmount();
    }
    renderScenario("6b");
    open("Vue d'ensemble");
    const rows = (await screen.findAllByTestId("decision")).map(text);
    expect(rows[0]).toContain("refusée par le contrat : délai d'approbation dépassé");
    expect(rows[1]).toContain("en attente d'approbation");
  });

  it("échéance passée sans clôture : le cas reste affiché, marqué dépassé", async () => {
    renderScenario("6", { t0: Date.now() - 120_000 });
    open("À valider");
    expect(await value("cas-delai")).toContain("échéance dépassée");
  });

  it("un rejeu de la demande en attente ne ferme pas le cas", async () => {
    renderScenario("6", {
      tamper: (path, body) => {
        if (!path.startsWith("/decisions")) return body;
        const rows = body as Row[];
        const first = rows[0] as Row;
        return [...rows, { ...first, id: 999, decision: 0, reason: 3, reason_name: "REQUEST_REPLAYED", effective_decision: 0, log_index: 0, block_number: Number(first.block_number) + 5, tx_hash: `0x${"ab".repeat(32)}` }];
      },
    });
    open("À valider");
    expect(await screen.findAllByTestId("cas-en-attente")).toHaveLength(1);
  });
});

describe("écran Campagne", () => {
  it("chiffres figés du rapport, étiquetés hors ligne, avec leurs réserves", () => {
    renderScenario("1");
    open("Campagne");
    expect(text(screen.getByTestId("campagne-avis"))).toContain("ne les lit pas dans les services");
    expect(text(screen.getByTestId("campagne-sorti"))).toBe("0 €");
    expect(screen.getAllByTestId("campagne-famille")).toHaveLength(18);
    expect(screen.getAllByTestId("campagne-passage").map(text)).toEqual([
      expect.stringContaining("Porte d'entrée 292 · File d'attente 15 · Relais 15 · Contrat 178"),
      expect.stringContaining("Porte d'entrée 180 · File d'attente 15 · Relais 15 · Contrat 290"),
    ]);
    // Le cas où des fonds partent et la réserve sur le détecteur s'affichent avec le reste.
    expect(text(screen.getByTestId("campagne-perte"))).toBe("101 130 €");
    expect(text(screen.getByTestId("campagne-portee"))).toContain("détecte 50 attaques sur 100 et bloque 4 factures légitimes sur 100");
    expect(screen.getAllByText("campagne hors ligne").length).toBeGreaterThan(0);
  });

  it("les familles et les passages totalisent 500 tentatives", () => {
    expect(CAMPAGNE.families.reduce((sum, f) => sum + f.attempts, 0)).toBe(500);
    for (const p of CAMPAGNE.passages) expect(p.stopped.reduce((sum, n) => sum + n, 0)).toBe(500);
  });
});
