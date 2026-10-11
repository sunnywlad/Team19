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
    expect(screen.getAllByText("Chargement…")).toHaveLength(5);
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(5);
    expect(screen.queryByTestId("placable")).toBeNull();
    expect(screen.getByTestId("maj-relay").textContent).toBe("jamais lu");
  });

  it("vide : chaque écran dit qu'il n'y a rien, sans tableau fantôme", async () => {
    renderScenario("2");
    expect(await screen.findByText("Aucune décision du contrat pour l'instant.")).toBeTruthy();
    expect(await screen.findByText("Aucun incident : aucun délai à mesurer.")).toBeTruthy();
    open("Incidents");
    expect(await screen.findByText("Aucun incident.")).toBeTruthy();
    expect(await screen.findByText("Aucun agent en pause sur la chaîne.")).toBeTruthy();
    open("En attente");
    expect(await screen.findByText("Aucun cas en attente.")).toBeTruthy();
    open("Journal");
    expect(await screen.findByText("Aucun rapport : aucune tête de référence.")).toBeTruthy();
  });

  it("erreur : un statut HTTP ou un corps illisible donne une erreur explicite sur chaque écran", async () => {
    render(<App client={new SimulatedApiClient(async () => ({ ok: false, status: 503, json: async () => ({}) }) as Response)} />);
    await waitFor(() => expect(screen.getAllByText(/Lecture en échec : l'API a répondu 503\. Rien n'est affiché\./)).toHaveLength(5));
    for (const name of SCREENS) {
      open(name);
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    }
  });

  it("erreur : une réponse qui n'est pas du JSON n'est pas affichée", async () => {
    const broken = async (): Promise<Response> =>
      ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("Unexpected token <")) }) as unknown as Response;
    render(<App client={new SimulatedApiClient(broken)} />);
    await waitFor(() => expect(screen.getAllByText(/réponse illisible : ce n'est pas du JSON/)).toHaveLength(5));
  });
});

describe("thème", () => {
  it("système par défaut, puis clair, puis sombre, et le choix est gardé", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    const first = renderScenario("1");
    const button = screen.getByRole("button", { name: "Thème : système" });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    await user.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await user.click(screen.getByRole("button", { name: "Thème : clair" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    first.unmount();

    renderScenario("1");
    expect(screen.getByRole("button", { name: "Thème : sombre" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Thème : sombre" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
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
    expect(document.activeElement?.textContent).toMatch(/^Thème/);
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Décisions");

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement?.textContent).toBe("Incidents");
    expect(screen.getByRole("button", { name: "Incidents", current: "page" })).toBeTruthy();
    expect(await screen.findByText("Aucun incident.")).toBeTruthy();

    await user.keyboard("{End}");
    expect(screen.getByRole("button", { name: "Journal", current: "page" })).toBeTruthy();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("button", { name: "En attente", current: "page" })).toBeTruthy();
    expect(await screen.findAllByTestId("cas-en-attente")).toHaveLength(1);
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(screen.getByRole("button", { name: "Supervision", current: "page" })).toBeTruthy();
    await user.keyboard("{ArrowLeft}{Home}");
    expect(screen.getByRole("button", { name: "Supervision", current: "page" })).toBeTruthy();
    expect(window.location.hash).toBe("#supervision");
  });

  it("« Aller au contenu » amène le clavier dans l'écran, et l'écran suit l'ancre de l'adresse", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "#journal");
    renderScenario("4");
    expect(screen.getByRole("button", { name: "Journal", current: "page" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Aller au contenu" }));
    expect(document.activeElement?.tagName).toBe("MAIN");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Journal");

    // Une ancre inconnue ne choisit rien : retour à l'écran Décisions.
    window.history.replaceState(null, "", "#<img src=x onerror=1>");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByRole("button", { name: "Décisions", current: "page" })).toBeTruthy();
  });
});
