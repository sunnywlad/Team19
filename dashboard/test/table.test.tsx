// Table ronde : un siège par couche réelle, un verdict lu dans les traces de
// cette couche, et du mouvement seulement quand un verdict change.
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildWorld, type ScenarioName } from "../fixtures/scenarios.ts";
import { SimulatedApiClient } from "../src/api/client.ts";
import { App } from "../src/App.tsx";
import { seatsFor } from "../src/domain/table.ts";
import { fixtureFetch, renderScenario, text } from "./helpers.tsx";

const verdicts = (): Record<string, string | null> =>
  Object.fromEntries(["porte", "ia", "relais", "contrat", "humain"].map((k) => [k, screen.getByTestId(`siege-${k}`).getAttribute("data-verdict")]));

async function table(name: ScenarioName): Promise<Record<string, string | null>> {
  renderScenario(name);
  await screen.findByTestId("table-ronde");
  return verdicts();
}

describe("table ronde", () => {
  it("cinq sièges, ceux du flux, et aucun autre", async () => {
    await table("1");
    const names = [...document.querySelectorAll(".siege-nom")].map(text);
    expect(names).toEqual(["Porte d'entrée", "IA du client", "Relais", "Contrat", "Humain"]);
  });

  it("scénario 1 : tout passe, l'humain n'est pas requis", async () => {
    expect(await table("1")).toEqual({ porte: "passe", ia: "passe", relais: "passe", contrat: "passe", humain: "non-atteint" });
    expect(text(screen.getByTestId("siege-humain"))).toContain("non requis");
    expect(screen.getByTestId("table-ronde").getAttribute("data-issue")).toBe("passe");
    expect(document.querySelectorAll('[data-etat="allume"]')).toHaveLength(3);
  });

  it("scénario 3 : veto de la porte d'entrée, motif et score ; le reste n'est pas atteint", async () => {
    expect(await table("3")).toEqual({ porte: "veto", ia: "non-atteint", relais: "non-atteint", contrat: "non-atteint", humain: "non-atteint" });
    expect(text(screen.getByTestId("siege-porte"))).toContain("instruction dans une donnée · score 93 pour un seuil de 70");
    expect(text(screen.getByTestId("table-issue"))).toBe("Veto · Porte d'entrée");
    expect(document.querySelectorAll('[data-etat="allume"]')).toHaveLength(0);
  });

  it("scénario 4 : la porte laisse passer, le contrat met son veto (facture inconnue)", async () => {
    expect(await table("4")).toMatchObject({ porte: "passe", contrat: "veto", humain: "non-atteint" });
    expect(text(screen.getByTestId("siege-contrat"))).toContain("facture inconnue");
  });

  it("scénarios 6, 6a, 6b : l'humain attend, approuve, ou laisse passer le délai", async () => {
    for (const [name, human] of [["6", "attente"], ["6a", "passe"], ["6b", "veto"]] as const) {
      const view = renderScenario(name);
      await screen.findByTestId("table-ronde");
      expect(verdicts()).toMatchObject({ contrat: "passe", humain: human });
      view.unmount();
    }
  });

  it("scénario 5 : le relais tient la demande en file, puis elle expire", async () => {
    const t0 = Date.now() - 5000;
    const first = renderScenario("5", { t0, now: t0 + 20_000 });
    await screen.findByTestId("table-ronde");
    expect(verdicts()).toMatchObject({ ia: "passe", relais: "attente", contrat: "non-atteint" });
    first.unmount();
    renderScenario("5", { t0 });
    await screen.findByTestId("table-ronde");
    expect(verdicts()).toMatchObject({ relais: "veto", contrat: "non-atteint" });
    expect(text(screen.getByTestId("siege-relais"))).toContain("expirée en file");
  });

  it("sans journal du même monde : aucune couche amont n'est cochée par déduction", () => {
    const world = buildWorld("1", Date.now() - 5000);
    const requestId = world.events.find((e) => e.name === "Decision")?.request_id ?? "";
    const seats = seatsFor({ requestId, decisions: [], queue: [], journal: null });
    expect(seats.every((s) => s.verdict === "non-atteint")).toBe(true);
  });

  it("mouvement : seul le siège dont le verdict change bouge, une fois", async () => {
    vi.useFakeTimers();
    // Le cas est déjà ouvert à l'ouverture de la page ; l'approbation arrive à t0 + 12 s.
    const t0 = Date.now() - 3000;
    render(<App client={new SimulatedApiClient(fixtureFetch(() => buildWorld("6a", t0, Date.now())))} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(1000)));
    expect(screen.getByTestId("siege-humain").getAttribute("data-verdict")).toBe("attente");
    expect(document.querySelectorAll(".siege-change")).toHaveLength(0);
    await act(async () => void (await vi.advanceTimersByTimeAsync(12_000)));
    expect(screen.getByTestId("siege-humain").getAttribute("data-verdict")).toBe("passe");
    expect([...document.querySelectorAll(".siege-change")].map((e) => e.closest(".siege")?.getAttribute("data-testid"))).toEqual(["siege-humain"]);
  });
});
