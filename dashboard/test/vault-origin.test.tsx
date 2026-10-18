// Honnêteté en mode faux coffre : le proxy local dit ce que le relais a
// derrière lui, et la page ne présente jamais un faux coffre comme un vrai.
import { render, screen } from "@testing-library/react";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { buildWorld, type ScenarioName } from "../fixtures/scenarios.ts";
import { RealApiClient } from "../src/api/client.ts";
import type { FetchLike } from "../src/api/http.ts";
import { App } from "../src/App.tsx";
import { LOCAL_MODE_PATH, localMode, vaultModeFrom } from "../vite.config.ts";
import { fixtureFetch, renderScenario, startOfScript, text, type Call } from "./helpers.tsx";
import { open } from "./tour.ts";

const NOTICE = "COFFRE SIMULÉ : aucun fonds, aucune chaîne";

/** Le monde des fixtures par les routes du relais, et le mode servi comme le fait le proxy local. */
function realClient(mode: unknown, calls: Call[] = [], status = 200, scenario: ScenarioName = "1"): RealApiClient {
  const world = fixtureFetch(() => buildWorld(scenario, startOfScript()), { calls });
  const fetchFn: FetchLike = async (input, init) => {
    if (input !== LOCAL_MODE_PATH) return world(input, init);
    calls.push({ method: init.method ?? "GET", url: input });
    return { ok: status === 200, status, json: async () => mode } as Response;
  };
  return new RealApiClient({ vaultFromRelay: true, responseAvailable: true }, fetchFn);
}

/** Étiquette de provenance dans l'en-tête du panneau dont le titre est donné. */
const tagOf = (title: string): string => text(screen.getByRole("heading", { name: title }).parentElement!.querySelector(".source")!);

describe("mode faux coffre", () => {
  it("bandeau permanent et étiquette « simulation » sur ce que le faux coffre alimente, sur chaque écran", async () => {
    render(<App client={realClient({ vault: "fake" })} />);
    expect(text(await screen.findByTestId("bandeau-coffre-simule"))).toContain(NOTICE);
    await screen.findAllByTestId("decision");
    expect(tagOf("Montant plaçable")).toBe("simulation");
    expect(tagOf("Décisions du contrat")).toBe("simulation");
    expect(text(screen.getByTestId("decisions-simulees"))).toContain("faux coffre");
    expect(text(screen.getByTestId("placable-origine"))).toContain("faux coffre");
    expect(text(screen.getByTestId("placable-origine"))).not.toContain("lues dans le contrat");
    // La file et le journal sont de vrais services : ils gardent « réel ».
    expect(tagOf("File du relais")).toBe("réel");
    expect(tagOf("Arrêtées à la porte d'entrée")).toBe("réel");
    expect(text(screen.getByLabelText("Dernière mise à jour par source"))).toMatch(/relais réel .*coffre simulation .*service de réponse réel/);

    for (const [tab, title] of [["À valider", "Cas en attente d'une validation humaine"], ["Incidents", "Agents en pause, sur la chaîne"]] as const) {
      open(tab);
      await screen.findByRole("heading", { name: title });
      expect(tagOf(title)).toBe("simulation");
      expect(text(screen.getByTestId("bandeau-coffre-simule"))).toContain(NOTICE);
    }
    open("Piste d'audit");
    await screen.findByRole("heading", { name: "Journal chaîné" });
    expect(tagOf("Journal chaîné")).toBe("réel");
    expect(text(screen.getByTestId("bandeau-coffre-simule"))).toContain(NOTICE);
  });

  it("rapport d'incident : la décision « du contrat » est marquée faux coffre, et seulement en mode fake", async () => {
    const fake = render(<App client={realClient({ vault: "fake" }, [], 200, "4")} />);
    open("Incidents");
    expect(text(await screen.findByTestId("decision-contrat-simulee"))).toBe("simulation faux coffre : aucun contrat n'a jugé");
    fake.unmount();
    render(<App client={realClient({ vault: "chain" }, [], 200, "4")} />);
    open("Incidents");
    await screen.findByTestId("decision-contrat");
    expect(screen.queryByTestId("decision-contrat-simulee")).toBeNull();
  });

  it("mode chain : aucun bandeau, étiquettes « réel »", async () => {
    render(<App client={realClient({ vault: "chain" })} />);
    await screen.findAllByTestId("decision");
    await screen.findByText(/lues dans le contrat au bloc/);
    expect(screen.queryByTestId("bandeau-coffre-simule")).toBeNull();
    expect(screen.queryByTestId("bandeau-coffre-non-confirme")).toBeNull();
    expect(tagOf("Montant plaçable")).toBe("réel");
    expect(tagOf("Décisions du contrat")).toBe("réel");
  });

  it("mode non dit, réponse illisible ou proxy muet : jamais « réel » sur le coffre", async () => {
    for (const [mode, status] of [[{ vault: "unknown" }, 200], [{ vault: "chain", extra: 1 }, 200], [{ vault: "mainnet" }, 200], ["fake", 200], [{}, 404]] as const) {
      const view = render(<App client={realClient(mode, [], status)} />);
      expect(text(await screen.findByTestId("bandeau-coffre-non-confirme"))).toContain("Origine du coffre non confirmée");
      await screen.findAllByTestId("decision");
      expect(tagOf("Montant plaçable")).toBe("origine non confirmée");
      expect(tagOf("Décisions du contrat")).toBe("origine non confirmée");
      expect(screen.queryByTestId("bandeau-coffre-simule")).toBeNull();
      view.unmount();
    }
  });

  it("le mode se lit par un GET sur l'origine de la page ; rien n'est demandé au relais en plus", async () => {
    const calls: Call[] = [];
    render(<App client={realClient({ vault: "fake" }, calls)} />);
    await screen.findByTestId("bandeau-coffre-simule");
    expect(calls.filter((c) => c.url === LOCAL_MODE_PATH).every((c) => c.method === "GET")).toBe(true);
    expect(calls.some((c) => c.url === LOCAL_MODE_PATH)).toBe(true);
    expect(calls.filter((c) => c.url.startsWith("/api/relay/")).map((c) => c.url.replace(/\?.*$/, "")).sort().filter((u, i, a) => a.indexOf(u) === i)).toEqual([
      "/api/relay/decisions",
      "/api/relay/events",
      "/api/relay/queue",
      "/api/relay/status",
      "/api/relay/vault",
    ]);
  });

  it("monde simulé par les fixtures : pas de bandeau de faux coffre, étiquettes inchangées", async () => {
    renderScenario("1");
    await screen.findAllByTestId("decision");
    expect(screen.queryByTestId("bandeau-coffre-simule")).toBeNull();
    expect(screen.queryByTestId("bandeau-coffre-non-confirme")).toBeNull();
    expect(tagOf("Montant plaçable")).toBe("simulation");
  });
});

describe("proxy local, /api/local/mode", () => {
  const call = (mode: Parameters<typeof localMode>[0], url: string): { status?: number; body?: string; passed: boolean } => {
    const seen: { status?: number; body?: string; passed: boolean } = { passed: false };
    const res = { writeHead: (status: number) => void (seen.status = status), end: (body: string) => void (seen.body = body) } as unknown as ServerResponse;
    localMode(mode)({ url } as IncomingMessage, res, () => void (seen.passed = true));
    return seen;
  };

  it("RELAY_VAULT_MODE : fake ou chain ; tout le reste est « unknown », jamais chain par défaut", () => {
    expect(vaultModeFrom("fake")).toBe("fake");
    expect(vaultModeFrom(" chain ")).toBe("chain");
    for (const raw of [undefined, "", "1", "FAKE", "mainnet"]) expect(vaultModeFrom(raw)).toBe("unknown");
  });

  it("sert un seul champ, et laisse passer les autres chemins", () => {
    expect(call("fake", "/api/local/mode")).toEqual({ status: 200, body: '{"vault":"fake"}', passed: false });
    expect(call("unknown", "/api/local/mode?x=1").body).toBe('{"vault":"unknown"}');
    expect(call("fake", "/api/relay/vault").passed).toBe(true);
    expect(call("fake", "/").passed).toBe(true);
  });
});
