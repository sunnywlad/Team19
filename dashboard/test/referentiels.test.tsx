// Écrans Fournisseurs, Agents et Règles : lecture seule, depuis les événements
// du contrat et GET /vault. Et, sur toute la console, rien de ce que
// docs/console/correspondance-console.md marque VISION.
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderScenario, text } from "./helpers.tsx";
import { SCREENS, open } from "./tour.ts";

const value = async (testId: string): Promise<string> => text(await screen.findByTestId(testId));

describe("écran Fournisseurs", () => {
  it("bénéficiaires inscrits, par leur libellé, avec factures et paiements ; aucun bouton Modifier", async () => {
    renderScenario("1");
    open("Fournisseurs");
    const rows = await screen.findAllByTestId("fournisseur");
    expect(rows).toHaveLength(3);
    const a = rows.find((r) => text(r).includes("Fournisseur fictif A"));
    expect(a).toBeTruthy();
    expect(text(a!)).toContain("0x33ff…1f2c");
    expect(text(a!)).toMatch(/1 10 u/);
    expect(screen.queryByRole("button", { name: /modifier|ajouter/i })).toBeNull();
  });
});

describe("écran Agents", () => {
  it("mandat en mots, blocages et pauses lus dans les deux sources", async () => {
    renderScenario("3");
    open("Agents");
    const rows = await screen.findAllByTestId("agent");
    expect(rows).toHaveLength(5);
    const attacked = rows.find((r) => text(r).includes("Agent factures 2"))!;
    expect(text(attacked)).toContain("payer une facture");
    expect(text(within(attacked).getByTestId("statut-agent"))).toBe("En pause, hors chaîne et sur la chaîne");
    const reader = rows.find((r) => text(r).includes("Agent lecture"))!;
    expect(text(reader)).toContain("aucune action : lecture seule");
    expect(screen.queryByRole("button", { name: /modifier|réactiver|suspendre/i })).toBeNull();
  });
});

describe("écran Règles", () => {
  it("seuil, délai de réponse, réserve et pause du coffre, lus ; aucun plafond, aucun bouton Modifier", async () => {
    renderScenario("1");
    open("Règles");
    expect(await value("regle-seuil")).toMatch(/25 u inscrit au bloc \d+/);
    expect(await value("regle-delai")).toMatch(/30 s inscrit au bloc \d+/);
    expect(await value("regle-reserve")).toMatch(/40 u inscrit au bloc \d+/);
    expect(await value("regle-pause")).toContain("Actif");
    expect(document.body.textContent).not.toMatch(/plafond/i);
    expect(screen.queryByRole("button", { name: /modifier/i })).toBeNull();
  });

  it("vue du coffre non lue : « non disponible », jamais 0", async () => {
    renderScenario("1", {
      tamper: (path, body) => (path === "/vault" ? { ...(body as object), threshold_wei: null, safety_reserve_wei: null, vault_paused: null } : body),
    });
    open("Règles");
    expect(await value("regle-seuil")).toMatch(/^Seuil de validation.*non disponible/);
    expect(await value("regle-reserve")).toContain("non disponible");
    expect(await value("regle-pause")).toContain("non disponible");
  });
});

describe("VISION : absent de toute la console", () => {
  it("ni écart à l'habitude, ni doublon, ni réactivation à deux, ni plafonds, ni export, ni SSO, ni rôles", async () => {
    renderScenario("scene");
    const forbidden = /plafond par paiement|plafond par jour|plafond du jour|réactivation|clôturer|exporter|export csv|pdf signé|\bSSO\b|se connecter|se déconnecter|rôles et accès|assouplir/i;
    for (const name of SCREENS) {
      open(name);
      await screen.findByRole("heading", { level: 1 });
      expect(document.body.textContent ?? "", name).not.toMatch(forbidden);
      for (const button of screen.queryAllByRole("button")) expect(text(button)).not.toMatch(/approuver|refuser|valider le paiement|signer|modifier|suspendre/i);
    }
    // Écart à l'habitude et doublon : nommés une fois, pour dire qu'ils ne sont pas calculés, jamais comme contrôle.
    open("À valider");
    fireEvent.keyDown(window, { key: "j" });
    expect(screen.queryAllByText("Écart à l'habitude")).toHaveLength(0);
  });
});
