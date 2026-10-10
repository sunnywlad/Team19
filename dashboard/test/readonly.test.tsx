// Lecture seule : pendant un parcours complet, aucun appel autre que GET.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { handleFixtureRequest } from "../fixtures/handler.ts";
import { buildWorld } from "../fixtures/scenarios.ts";
import { SimulatedApiClient, RealApiClient } from "../src/api/client.ts";
import { App } from "../src/App.tsx";
import { fixtureFetch, startOfScript, type Call } from "./helpers.tsx";
import { tour } from "./tour.ts";

describe("lecture seule", () => {
  it("le parcours complet de la scène n'émet que des GET, par fetch seulement", async () => {
    const calls: Call[] = [];
    const t0 = startOfScript();
    const stub = fixtureFetch(() => buildWorld("scene", t0), { calls });
    // Le client par défaut passe par le fetch global : c'est lui qu'on observe.
    const globalFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => stub(String(input), init ?? {}));
    vi.stubGlobal("fetch", globalFetch);
    const xhr = vi.spyOn(XMLHttpRequest.prototype, "open");

    render(<App client={new SimulatedApiClient()} />);
    await screen.findAllByTestId("decision");
    await tour();

    expect(calls.length).toBeGreaterThanOrEqual(9);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
    for (const [, init] of globalFetch.mock.calls) expect(init?.method).toBe("GET");
    expect(globalFetch.mock.calls.every(([, init]) => init?.body === undefined)).toBe(true);
    expect(xhr).not.toHaveBeenCalled();
    // Tous les appels restent sur l'origine de la page, sous /api/.
    expect(calls.every((c) => c.url.startsWith("/api/"))).toBe(true);
  });

  it("le client réel ne lit le relais que par GET, et garde la simulation pour les points manquants", async () => {
    const calls: Call[] = [];
    const client = new RealApiClient({}, fixtureFetch(() => buildWorld("1", startOfScript()), { calls }));
    await Promise.all([
      client.getRelayStatus(), client.getDecisions(), client.getEvents(), client.getQueue(), client.getVaultState(),
      client.getIncidents(), client.getJournalEntries(), client.getJournalVerification(), client.getPausedAgents(),
    ]);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.map((c) => c.url).sort()).toEqual([
      "/api/relay/decisions?limit=500",
      "/api/relay/events?limit=500",
      "/api/relay/queue?limit=500",
      "/api/relay/status",
      "/api/simulation/agents/paused",
      "/api/simulation/incidents",
      "/api/simulation/journal/entries?limit=500",
      "/api/simulation/journal/verification",
      "/api/simulation/vault",
    ]);
    expect(client.sources).toEqual({ relay: "reel", vault: "simulation", response: "simulation" });
  });

  it("le serveur de fixtures refuse toute méthode autre que GET, comme le relais", () => {
    const world = buildWorld("1", startOfScript());
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(handleFixtureRequest(world, method, "/decisions").status).toBe(405);
    }
    expect(handleFixtureRequest(world, "GET", "/decisions").status).toBe(200);
  });

  it("l'interface n'offre aucune commande d'action", async () => {
    render(<App client={new SimulatedApiClient(fixtureFetch(() => buildWorld("6", startOfScript())))} />);
    await screen.findAllByTestId("decision");
    await tour();
    expect(document.querySelectorAll("form, input, textarea, select")).toHaveLength(0);
    // Les seuls boutons changent ce qu'on regarde : écran, incident, thème.
    const buttons = screen.queryAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const button of buttons) {
      expect(["navigation", "affichage"]).toContain(button.getAttribute("data-ui"));
      expect(button.textContent ?? "").not.toMatch(/^(approuver|payer|refuser|reprendre|valider|mettre en pause|lever)/i);
    }
    expect(document.querySelectorAll("a[href]")).toHaveLength(0);
  });
});
