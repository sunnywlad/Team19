// Écrans Incident, Journal et En attente, sur les scénarios qui les concernent.
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderScenario, text } from "./helpers.tsx";
import { open } from "./tour.ts";

const value = async (testId: string): Promise<string> => text(await screen.findByTestId(testId));
type Row = Record<string, unknown>;

describe("écran Incident", () => {
  it("scénario 3 : incident ouvert, codes, score, contrat non atteint, actions, agent en pause, montant sorti 0", async () => {
    renderScenario("3");
    open("Alertes et rapports");
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
    // A-DEM-2, abrégé : en pause hors chaîne, puis sur la chaîne.
    expect(await value("agent-en-pause")).toContain("Agent 0x4c7f…232c en pause");
    expect(await value("agent-en-pause-chaine")).toContain("Agent 0x4c7f…232c en pause depuis le bloc");
    expect(await value("delai-arrivee-detection")).toContain("41 ms");
  });

  it("scénario 4 : refus du contrat, montant exposé inconnu du contrat, sorti 0, compteur des demandes passées +1", async () => {
    renderScenario("4");
    open("Alertes et rapports");
    expect(await value("compteur-manquees")).toBe("1");
    expect(await value("etat-incident")).toBe("ouvert");
    expect(await value("codes")).toBe("aucun : la demande a passé la porte d'entrée");
    expect(await value("decision-contrat")).toMatch(/^Refusé refusée par le contrat : facture inconnue/);
    expect(await value("expose")).toBe("inconnu du contrat");
    expect(await value("sorti")).toBe("0 u");
    expect(await value("agent-en-pause")).toContain("0x2105…1a0a");
  });

  it("scénarios sans incident : 1, 2, 5, 6, 7 et 8", async () => {
    for (const name of ["1", "2", "5", "6", "7", "8"] as const) {
      const view = renderScenario(name);
      open("Alertes et rapports");
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

    open("Alertes et rapports");
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
    open("Alertes et rapports");
    expect((await screen.findAllByText(/Lecture en échec : incidents : réponse non conforme au schéma/)).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("rapport")).toBeNull();
    expect(document.body.textContent).not.toContain("paiement urgent");
  });
});

describe("écran Journal", () => {
  it("sans vérification rapportée : « non vérifié », jamais « intègre » ni « intact »", async () => {
    renderScenario("2");
    open("Accueil");
    expect(await value("verdict")).toMatch(/^Non vérifié/);
    expect(await value("tete")).toMatch(/^Entrée 0 · [0-9a-f]{64}$/);
    expect(document.body.textContent).not.toMatch(/intègre|intact/i);
    expect(await value("limite")).toContain(
      "la suppression des dernières entrées n'est détectée que si l'empreinte de tête est conservée ailleurs",
    );
  });

  it("vérification réussie : résultat, date, limite, et tête des rapports comparée au journal", async () => {
    renderScenario("4");
    open("Accueil");
    expect(await value("verdict")).toMatch(/^Chaîne intègre sur 14 entrées\. Vérifiée sans tête de référence/);
    expect(await value("verification-date")).toMatch(/^Dernière vérification : \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2} horloge : journal · jusqu'à l'entrée 13$/);
    expect(await value("limite")).toContain("conservée ailleurs");
    expect(await value("tete-rapport")).toContain("concorde avec le journal");
    expect((await screen.findAllByTestId("entree")).length).toBe(14);
    expect(document.body.textContent).not.toMatch(/intact/i);
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
    open("Accueil");
    expect(await value("verdict")).toBe("Chaîne rompue : empreinte recalculée différente : une entrée a été modifiée à l'entrée 7.");
    expect(await value("non-verifiees")).toBe("4 entrées écrites depuis cette vérification : non vérifiées.");
    expect(await value("tete-rapport")).toContain("le journal est plus court que cette tête : des entrées manquent");
  });
});

describe("écran En attente", () => {
  it("scénario 6 : facture, montant, bénéficiaire et délai restant ; rien d'autre", async () => {
    renderScenario("6");
    open("Validation");
    expect(await screen.findAllByTestId("cas-en-attente")).toHaveLength(1);
    // F-002 et B-002, abrégés.
    expect(await value("cas-reference")).toBe("0x6caf…ce3e · paiement de facture");
    expect(await value("cas-montant")).toBe("30 u");
    expect(await value("cas-beneficiaire")).toBe("0x6fc1…0db1");
    expect(await value("cas-delai")).toMatch(/^2\d s avant refus automatique$/);
    expect(await screen.findByText(/La justification rédigée par un agent n'est jamais affichée/)).toBeTruthy();
  });

  it("scénario 6 a (approuvé) et 6 b (délai dépassé) : plus aucun cas en attente", async () => {
    for (const name of ["6a", "6b"] as const) {
      const view = renderScenario(name);
      open("Validation");
      expect(await screen.findByText("Aucun cas en attente.")).toBeTruthy();
      view.unmount();
    }
    renderScenario("6b");
    open("Accueil");
    const rows = (await screen.findAllByTestId("decision")).map(text);
    expect(rows[0]).toContain("refusée par le contrat : délai d'approbation dépassé");
    expect(rows[1]).toContain("en attente d'approbation");
  });

  it("échéance passée sans clôture : le cas reste affiché, marqué dépassé", async () => {
    renderScenario("6", { t0: Date.now() - 120_000 });
    open("Validation");
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
    open("Validation");
    expect(await screen.findAllByTestId("cas-en-attente")).toHaveLength(1);
  });
});

describe("page Validation", () => {
  it("scénario 6 : la commande de l'approbateur, avec l'identifiant complet, et aucun bouton qui approuve", async () => {
    renderScenario("6");
    open("Validation");
    const approve = text(await screen.findByTestId("commande-approve"));
    expect(approve).toMatch(/^node demo\/human\.mjs approve 0x[0-9a-f]{64}$/);
    expect(text(screen.getByTestId("commande-refuse"))).toMatch(/^node demo\/human\.mjs refuse 0x[0-9a-f]{64}$/);
    expect(screen.queryByTestId("commande-expire")).toBeNull();
    expect(document.body.textContent).toContain("À signer par l'approbateur");
    expect(document.body.textContent).not.toContain("PRIVATE_KEY=");
    for (const button of screen.queryAllByRole("button")) expect(button.textContent ?? "").not.toMatch(/approuv|refus|sign/i);
  });

  it("échéance dépassée : seule la commande « expire » est proposée", async () => {
    renderScenario("6", { t0: Date.now() - 120_000 });
    open("Validation");
    expect(text(await screen.findByTestId("commande-expire"))).toMatch(/^node demo\/human\.mjs expire 0x[0-9a-f]{64}$/);
    expect(screen.queryByTestId("commande-approve")).toBeNull();
  });
});

describe("page Alertes et rapports", () => {
  it("scénario 3 : alerte de sécurité lue au journal, et rapport enregistré tel que l'API l'a servi", async () => {
    const saved: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => (saved.push(b), "blob:local"), revokeObjectURL: () => undefined }));
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    const calls: { method: string; url: string }[] = [];
    renderScenario("3", { calls });
    open("Alertes et rapports");
    const [alert] = await screen.findAllByTestId("alerte");
    expect(text(alert as Element)).toMatch(/^alerte de sécurité · pour analyste, trésorier/);
    expect(await value("rapport-empreinte")).toMatch(/^[0-9a-f]{64}$/);
    const before = calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Télécharger le rapport (JSON)" }));
    expect(calls.length).toBe(before);
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatch(/^rapport-incident-0x[0-9a-f]{64}\.json$/);
    const report = JSON.parse(await (saved[0] as Blob).text()) as { incident_id: string; trigger: string };
    expect(report.trigger).toBe("DETECTOR_SCORE");
    expect(document.querySelectorAll("a[href]")).toHaveLength(0);
  });
});

describe("page Rôles", () => {
  it("pouvoirs recopiés, détenteurs « non disponible », mandats lus dans les événements", async () => {
    renderScenario("3");
    open("Rôles");
    expect(await screen.findAllByTestId("role")).toHaveLength(6);
    for (const row of screen.getAllByTestId("role")) expect(text(row)).toContain("non disponible");
    const mandates = (await screen.findAllByTestId("mandat")).map(text);
    expect(mandates).toHaveLength(5);
    expect(mandates.filter((m) => m.includes("payer une facture"))).toHaveLength(3);
    expect(mandates.filter((m) => m.includes("en pause sur la chaîne"))).toHaveLength(1);
    expect(mandates.some((m) => m.includes("aucun droit d'action"))).toBe(true);
  });
});
