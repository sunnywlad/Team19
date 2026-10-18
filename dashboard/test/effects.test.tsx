// Effets visuels, chacun piloté par une lecture réelle : rien ne bouge sans
// changement des données (sauf la pulsation d'un agent tant qu'il est en pause).
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildWorld, type ScenarioName } from "../fixtures/scenarios.ts";
import { SimulatedApiClient } from "../src/api/client.ts";
import { App } from "../src/App.tsx";
import { fixtureFetch, renderScenario } from "./helpers.tsx";
import { open } from "./tour.ts";

const advance = (ms: number): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

/** Le script se déroule en temps simulé : le monde servi dépend de l'heure courante. */
function live(name: ScenarioName, t0: number) {
  return render(<App client={new SimulatedApiClient(fixtureFetch(() => buildWorld(name, t0, Date.now())))} />);
}

describe("effet a : flux vivant", () => {
  it("à l'ouverture, rien ne s'anime ; une nouvelle décision illumine son chemin, dans sa couleur", async () => {
    vi.useFakeTimers();
    live("1", Date.now() + 500);
    open("Supervision");
    await advance(100);
    expect(screen.getByTestId("flux").getAttribute("data-nouveau")).toBe("false");
    await advance(3000);
    const flux = screen.getByTestId("flux");
    expect(flux.getAttribute("data-nouveau")).toBe("true");
    expect(flux.getAttribute("data-ton")).toBe("accepte");
    expect(flux.querySelector('[data-arete="contrat-paiement"]')?.getAttribute("data-etat")).toBe("actif");
    expect(flux.querySelector('[data-arete="contrat-humain"]')?.getAttribute("data-etat")).toBe("repos");
    expect(screen.getByTestId("flux-annonce").textContent).toContain("acceptée et payée");
  });

  it("arrêt à la porte : chemin gris, branche Réponse allumée", async () => {
    renderScenario("3");
    open("Supervision");
    const flux = await screen.findByTestId("flux");
    await vi.waitFor(() => expect(flux.getAttribute("data-ton")).toBe("bloque"));
    expect(flux.querySelector('[data-arete="porte-reponse"]')?.getAttribute("data-etat")).toBe("actif");
    expect(flux.querySelector('[data-noeud="contrat"]')?.getAttribute("data-etat")).toBe("repos");
  });
});

describe("effet b : échéance d'un cas en attente", () => {
  const gauge = (): HTMLElement => screen.getByTestId("cas-delai").querySelector('[data-testid="echeance"]') as HTMLElement;
  const state = (): string | null => gauge().getAttribute("data-etat");
  const cases = (): number => Number(gauge().getAttribute("data-cases"));
  const drawn = (kind: string): number => gauge().querySelectorAll(`.segments i.${kind}`).length;
  const shown = (testId: string): string => (gauge().querySelector(`[data-testid="${testId}"]`)?.textContent ?? "").replace(/\s+/g, " ").trim();

  it("normal, puis proche dans le dernier quart, puis échue : 24 cases depuis l'échéance lue dans HoldPlaced", async () => {
    vi.useFakeTimers();
    live("6", Date.now() - 3000);
    open("En attente");
    await advance(100);

    // Normal : la jauge est presque pleine, le temps s'écrit sans secondes, la règle est dite.
    expect(state()).toBe("normal");
    const first = cases();
    expect(first).toBeGreaterThan(18);
    expect(first).toBeLessThanOrEqual(24);
    expect(drawn("on")).toBe(first);
    expect(drawn("on") + drawn("ecoule")).toBe(24);
    expect(shown("echeance-temps")).toBe("moins d'1 min");
    expect(shown("echeance-phrase")).toBe("Sans signature avant l'échéance : refusé.");
    expect(gauge().querySelector('[data-testid="echeance-proche"]')).toBeNull();
    expect(gauge().querySelector(".segments")?.getAttribute("aria-label")).toBe("moins d'1 min restantes ; 24 cases, une case vaut 1/24 du délai");

    // La jauge se vide avec le délai.
    await advance(10_000);
    expect(state()).toBe("normal");
    expect(cases()).toBeLessThan(first);

    // Proche : dernier quart du délai, dit en toutes lettres, pas par la couleur seule.
    await advance(14_000);
    expect(state()).toBe("proche");
    expect(cases()).toBeLessThanOrEqual(6);
    expect(shown("echeance-proche")).toBe("Échéance proche");
    expect(shown("echeance-phrase")).toBe("Sans signature avant l'échéance : refusé.");

    // Échue : plus aucune case pleine, et ce qui se passe sans signature.
    await advance(10_000);
    expect(state()).toBe("echue");
    expect(cases()).toBe(0);
    expect(drawn("echue")).toBe(24);
    expect(shown("echeance-temps")).toBe("Échéance dépassée");
    expect(shown("echeance-phrase")).toContain("la demande est refusée (APPROVAL_TIMEOUT). Rien n'est parti.");
    expect(gauge().querySelector('[data-testid="echeance-proche"]')).toBeNull();
  });

  it("le temps restant ne s'écrit jamais en secondes, et la jauge n'est pas un bouton", async () => {
    vi.useFakeTimers();
    live("6", Date.now() - 3000);
    open("En attente");
    await advance(100);
    for (let i = 0; i < 6; i += 1) {
      expect(shown("echeance-temps")).not.toMatch(/\d\s*s\b|″/);
      await advance(5000);
    }
    expect(gauge().querySelectorAll("button, input, a, [role='button'], [tabindex]")).toHaveLength(0);
  });
});

describe("effet c : barre empilée du plaçable", () => {
  it("cash = dettes + réserve + placements bloqués + plaçable, parts lues dans GET /vault ; un montant qui change roule", async () => {
    vi.useFakeTimers();
    live("6a", Date.now() - 3000);
    await advance(100);
    const bar = screen.getByTestId("barre-placable");
    expect(bar.getAttribute("data-etat")).toBe("egal");
    const parts = Object.fromEntries([...bar.querySelectorAll("[data-segment]")].map((r) => [r.getAttribute("data-segment"), Number(r.getAttribute("data-part"))]));
    expect(parts).toEqual({ dettes: 40, reserve: 40, "placements-bloques": 0, placable: 20 });
    expect(screen.getByTestId("cash").querySelector("[data-roule]")?.getAttribute("data-roule")).toBe("non");
    await advance(12_000);
    expect(screen.getByTestId("cash").textContent).toBe("70 u");
    expect(screen.getByTestId("cash").querySelector("[data-roule]")?.getAttribute("data-roule")).toBe("oui");
  });
});

describe("effet d : incident", () => {
  it("un incident lu après l'ouverture entre en tête de liste ; son agent en pause porte la pastille", async () => {
    vi.useFakeTimers();
    live("scene", Date.now());
    open("Incidents");
    await advance(100);
    expect(screen.getByText("Aucun incident.")).toBeTruthy();
    await advance(6000);
    let cards = screen.getAllByTestId("carte-incident");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute("data-arrivee")).toBe("true");
    expect(cards[0]?.textContent).toContain("score du détecteur");
    expect(cards[0]?.querySelector('[data-testid="pastille-pause"]')?.textContent).toContain("en pause · hors chaîne");
    // Deuxième incident (refus du contrat) : il passe devant, et c'est lui qui entre.
    await advance(22_000);
    cards = screen.getAllByTestId("carte-incident");
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("refus du contrat");
    expect(cards[0]?.getAttribute("data-arrivee")).toBe("true");
    expect(cards[1]?.getAttribute("data-arrivee")).toBe("false");
  });

  it("à l'ouverture, les incidents déjà là n'entrent pas en glissant", async () => {
    renderScenario("4");
    open("Incidents");
    const [card] = await screen.findAllByTestId("carte-incident");
    expect(card?.getAttribute("data-arrivee")).toBe("false");
  });
});

describe("effet e : mode présentation", () => {
  it("P masque la navigation et agrandit le flux ; provenance et pied restent ; Échap en sort", async () => {
    renderScenario("1");
    await screen.findAllByTestId("decision");
    fireEvent.keyDown(window, { key: "p" });
    expect(document.querySelector(".page")?.getAttribute("data-presentation")).toBe("oui");
    expect(document.querySelector(".panneau-flux-grand")).not.toBeNull();
    expect(screen.getByTestId("pied-mention").textContent).toBe("Données fictives · réseau de test");
    expect(screen.getByRole("heading", { name: "Flux d'une demande" }).parentElement?.querySelector(".source")?.textContent).toBe("simulation");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".page")?.getAttribute("data-presentation")).toBe("non");
    expect(screen.getByRole("button", { name: "Décisions", current: "page" })).toBeTruthy();
    // Avec un modificateur, P ne fait rien : Ctrl+P reste l'impression du navigateur.
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    expect(document.querySelector(".page")?.getAttribute("data-presentation")).toBe("non");
  });
});
