// Finition : états de chargement, vide et erreur ; thème ; navigation au clavier.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SimulatedApiClient } from "../src/api/client.ts";
import { App } from "../src/App.tsx";
import { renderScenario } from "./helpers.tsx";
import { SCREENS, open } from "./tour.ts";

describe("états", () => {
  it("chargement : tant que rien n'est lu, aucune valeur n'est affichée", () => {
    render(<App client={new SimulatedApiClient(() => new Promise<Response>(() => undefined))} />);
    expect(screen.getAllByText("Chargement…")).toHaveLength(document.querySelectorAll(".panneau").length);
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(document.querySelectorAll(".panneau").length);
    expect(screen.queryByTestId("placable")).toBeNull();
    expect(screen.getByTestId("maj-relay").textContent).toBe("jamais lu");
  });

  it("vide : chaque écran dit qu'il n'y a rien, sans tableau fantôme", async () => {
    renderScenario("2");
    expect(await screen.findByText("Aucune décision du contrat pour l'instant.")).toBeTruthy();
    expect(await screen.findByText("Aucun incident : aucun délai à mesurer.")).toBeTruthy();
    open("Alertes et rapports");
    expect(await screen.findByText("Aucun incident.")).toBeTruthy();
    expect(await screen.findByText("Aucun agent en pause sur la chaîne.")).toBeTruthy();
    open("Validation");
    expect(await screen.findByText("Aucun cas en attente.")).toBeTruthy();
    open("Accueil");
    expect(await screen.findByText("Aucun rapport : aucune tête de référence.")).toBeTruthy();
  });

  it("erreur : un statut HTTP ou un corps illisible donne une erreur explicite sur chaque écran", async () => {
    render(<App client={new SimulatedApiClient(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response)} />);
    await waitFor(() => expect(screen.getAllByText(/Lecture en échec : l'API a répondu 503\. Rien n'est affiché\./)).toHaveLength(document.querySelectorAll(".panneau").length));
    for (const name of SCREENS) {
      open(name);
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    }
  });

  it("erreur : une réponse qui n'est pas du JSON n'est pas affichée", async () => {
    const broken = async (): Promise<Response> =>
      ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("Unexpected token <")) }) as unknown as Response;
    render(<App client={new SimulatedApiClient(broken)} />);
    await waitFor(() => expect(screen.getAllByText(/réponse illisible : ce n'est pas du JSON/)).toHaveLength(document.querySelectorAll(".panneau").length));
  });
});

describe("clavier", () => {
  it("tabulation jusqu'à la barre d'écrans, flèches pour changer d'écran, Début et Fin", async () => {
    const user = userEvent.setup();
    renderScenario("6");
    await screen.findAllByTestId("decision");

    await user.tab();
    expect(document.activeElement?.textContent).toBe("Aller au contenu");
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Accueil");

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.textContent).toBe("Validation");
    expect(screen.getByRole("button", { name: "Validation", current: "page" })).toBeTruthy();
    expect(await screen.findAllByTestId("cas-en-attente")).toHaveLength(1);

    await user.keyboard("{End}{ArrowLeft}");
    expect(screen.getByRole("button", { name: "Alertes et rapports", current: "page" })).toBeTruthy();
    expect(await screen.findByText("Aucun incident.")).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Accueil", current: "page" })).toBeTruthy();
    await user.keyboard("{ArrowLeft}{Home}");
    expect(screen.getByRole("button", { name: "Accueil", current: "page" })).toBeTruthy();
    expect(window.location.hash).toBe("#accueil");
  });

  it("« Aller au contenu » amène le clavier dans l'écran, et l'écran suit l'ancre de l'adresse", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "#alertes");
    renderScenario("4");
    expect(screen.getByRole("button", { name: "Alertes et rapports", current: "page" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Aller au contenu" }));
    expect(document.activeElement?.tagName).toBe("MAIN");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Alertes et rapports");

    // Une ancre inconnue ne choisit rien : retour à l'accueil.
    window.history.replaceState(null, "", "#<img src=x onerror=1>");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByRole("button", { name: "Accueil", current: "page" })).toBeTruthy();
  });
});
