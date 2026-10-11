// Données périmées : API coupée, le bandeau apparaît et les valeurs sont
// grisées. Une valeur périmée n'est jamais présentée comme à jour.
import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backoffDelay, isStale, MAX_BACKOFF_MS } from "../src/hooks/poller.ts";
import { renderScenario, text } from "./helpers.tsx";

const advance = (ms: number): Promise<void> => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("fraîcheur", () => {
  it("API coupée plus de 10 s : bandeau « données indisponibles », valeurs grisées, puis retour à la normale", async () => {
    vi.useFakeTimers();
    let down = false;
    const calls: { method: string; url: string }[] = [];
    renderScenario("1", { down: () => down, calls, t0: Date.now() - 5000 });
    await advance(50);

    const placeable = screen.getByTestId("placable");
    expect(text(placeable)).toBe("20 u");
    expect(placeable.closest("[data-perime]")?.getAttribute("data-perime")).toBe("false");
    expect(screen.queryByText("Données indisponibles")).toBeNull();
    expect(text(screen.getByTestId("maj-relay"))).toMatch(/^mis à jour à \d{2}:\d{2}:\d{2}$/);

    down = true;
    await advance(5000);
    // Moins de 10 s : l'erreur est dite, mais la valeur n'est pas encore périmée.
    expect(screen.getAllByText(/Lecture en échec : API injoignable/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Données indisponibles")).toBeNull();

    await advance(7000);
    const banner = screen.getByText("Données indisponibles").closest("[role=alert]") as Element;
    expect(text(banner)).toContain("relais, coffre, service de réponse injoignables depuis plus de 10 s");
    const zones = [...document.querySelectorAll("[data-perime]")];
    expect(zones.length).toBeGreaterThanOrEqual(4);
    for (const zone of zones) {
      expect(zone.getAttribute("data-perime")).toBe("true");
      expect(zone.classList.contains("perime")).toBe(true);
      expect(text(zone)).toContain("Valeurs périmées : dernière lecture réussie à");
    }
    // La dernière valeur connue reste lisible, étiquetée comme périmée.
    expect(text(screen.getByTestId("placable"))).toBe("20 u");

    down = false;
    await advance(MAX_BACKOFF_MS + 1000);
    expect(screen.queryByText("Données indisponibles")).toBeNull();
    expect(screen.getByTestId("placable").closest("[data-perime]")?.getAttribute("data-perime")).toBe("false");
  });

  it("API injoignable dès le départ : aucune valeur, erreur explicite, puis bandeau", async () => {
    vi.useFakeTimers();
    renderScenario("1", { down: () => true });
    await advance(50);
    expect(screen.queryByTestId("placable")).toBeNull();
    expect(screen.getAllByText(/Rien n'est affiché\./).length).toBe(5);
    await advance(11_000);
    expect(screen.getByText("Données indisponibles")).toBeTruthy();
  });

  it("interrogation toutes les 2 s, puis recul exponentiel borné en cas d'erreur", async () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((n) => backoffDelay(n))).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    const snapshot = { data: 1, lastOkAt: 1000, error: null, startedAt: 0, failures: 0 };
    expect(isStale(snapshot, 11_000)).toBe(false);
    expect(isStale(snapshot, 11_001)).toBe(true);
    expect(isStale({ ...snapshot, lastOkAt: null }, 10_001)).toBe(true);

    vi.useFakeTimers();
    const calls: { method: string; url: string }[] = [];
    let down = false;
    renderScenario("1", { calls, down: () => down });
    await advance(50);
    const status = (): number => calls.filter((c) => c.url.endsWith("/status")).length;
    expect(status()).toBe(1);
    await advance(6000);
    expect(status()).toBe(4);
    down = true;
    await advance(2000); // échec 1, prochain essai dans 4 s
    await advance(4000); // échec 2, prochain essai dans 8 s
    expect(status()).toBe(6);
    await advance(7000);
    expect(status()).toBe(6);
    await advance(1000);
    expect(status()).toBe(7);
  });
});
