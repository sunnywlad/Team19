// Honnêteté en mode faux coffre : le proxy local dit ce que le relais a
// derrière lui, et la page ne présente jamais un faux coffre comme un vrai.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { buildWorld, type ScenarioName } from "../fixtures/scenarios.ts";
import { RealApiClient } from "../src/api/client.ts";
import type { FetchLike } from "../src/api/http.ts";
import { App } from "../src/App.tsx";
import { LOCAL_MODE_PATH, localMode, vaultModeFrom } from "../vite.config.ts";
import { fixtureFetch, renderScenario, startOfScript, text, type Call } from "./helpers.tsx";
import { open } from "./tour.ts";

const NOTICE = "Coffre simulé : aucun fonds, aucune chaîne";

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

/**
 * Provenance dans l'en-tête du panneau dont le titre est donné : le texte que
 * lit un lecteur d'écran, le même que l'infobulle (« Source : coffre, réel, lu à… »).
 */
const tagOf = (title: string): string => {
  const tag = screen.getByRole("heading", { name: title }).parentElement!.querySelector<HTMLElement>(".source")!;
  expect(tag.getAttribute("title")).toBe(tag.querySelector(".visuellement-cache")?.textContent);
  return text(tag.querySelector(".visuellement-cache")!);
};

/** La puce d'environnement de la barre haute. */
const puce = async (): Promise<HTMLElement> => screen.findByTestId("puce-env");

/** Origine de chaque famille dans le panneau « Sources ». */
const origines = (): Record<string, string | null> =>
  Object.fromEntries([...screen.getByLabelText("Dernière mise à jour par source").querySelectorAll("li")].map((li) => [li.dataset.source, li.querySelector(".fraicheur-origine")!.textContent]));

describe("mode faux coffre", () => {
  it("puce permanente et provenance « simulation » sur ce que le faux coffre alimente, sur chaque écran", async () => {
    render(<App client={realClient({ vault: "fake" })} />);
    await waitFor(async () => expect((await puce()).getAttribute("data-env")).toBe("coffre-simule"));
    expect(text(await puce())).toContain(NOTICE);
    await screen.findAllByTestId("decision");
    expect(tagOf("Montant plaçable")).toMatch(/^Source : coffre, simulation \(faux coffre en mémoire : aucun fonds, aucune chaîne\), lu à /);
    expect(tagOf("Décisions du contrat")).toContain("simulation");
    expect(text(screen.getByTestId("decisions-simulees"))).toContain("faux coffre");
    expect(text(screen.getByTestId("placable-origine"))).toContain("faux coffre");
    expect(text(screen.getByTestId("placable-origine"))).not.toContain("lues dans le contrat");
    // La file et le journal sont de vrais services : ils gardent « réel ».
    expect(tagOf("File du relais")).toMatch(/^Source : relais, réel, lu à /);
    expect(tagOf("Arrêtées à la porte d'entrée")).toMatch(/^Source : service de réponse, réel, lu à /);
    expect(origines()).toEqual({
      relay: "réel",
      vault: "simulation (faux coffre en mémoire : aucun fonds, aucune chaîne)",
      response: "réel",
    });

    for (const [tab, title] of [["À valider", "Demandes renvoyées à un humain"], ["Incidents", "Agents en pause, sur la chaîne"]] as const) {
      open(tab);
      await screen.findByRole("heading", { name: title });
      expect(tagOf(title)).toContain("simulation");
      expect(text(await puce())).toContain(NOTICE);
    }
    open("Piste d'audit");
    await screen.findByRole("heading", { name: "Journal chaîné" });
    expect(tagOf("Journal chaîné")).toContain("réel");
    expect(text(await puce())).toContain(NOTICE);
  });

  it("la puce ouvre le panneau « Sources », l'icône d'un panneau aussi ; Échap le ferme", async () => {
    const user = userEvent.setup();
    render(<App client={realClient({ vault: "fake" })} />);
    await screen.findAllByTestId("decision");
    const sources = screen.getByTestId("panneau-sources");
    expect(sources.hidden).toBe(true);
    await user.click(await puce());
    expect(sources.hidden).toBe(false);
    expect((await puce()).getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(sources.hidden).toBe(true);
    expect(document.activeElement).toBe(await puce());
    await user.click(screen.getByRole("heading", { name: "Montant plaçable" }).parentElement!.querySelector<HTMLElement>(".source")!);
    expect(sources.hidden).toBe(false);
  });

  it("rapport d'incident : la décision « du contrat » est marquée faux coffre, et seulement en mode fake", async () => {
    const fake = render(<App client={realClient({ vault: "fake" }, [], 200, "4")} />);
    open("Incidents");
    expect(text(await screen.findByTestId("decision-contrat-simulee"))).toBe(
      "Source : simulation (faux coffre en mémoire : aucun fonds, aucune chaîne) faux coffre : aucun contrat n'a jugé",
    );
    fake.unmount();
    render(<App client={realClient({ vault: "chain" }, [], 200, "4")} />);
    open("Incidents");
    await screen.findByTestId("decision-contrat");
    expect(screen.queryByTestId("decision-contrat-simulee")).toBeNull();
  });

  it("mode chain : puce « Réseau de test », provenance « réel »", async () => {
    render(<App client={realClient({ vault: "chain" })} />);
    await screen.findAllByTestId("decision");
    await screen.findByText(/lues dans le contrat au bloc/);
    expect((await puce()).getAttribute("data-env")).toBe("reseau-test");
    expect(text(await puce())).toBe("Réseau de test, voir les sources");
    expect(tagOf("Montant plaçable")).toMatch(/^Source : coffre, réel, lu à /);
    expect(tagOf("Décisions du contrat")).toMatch(/^Source : relais, réel, lu à /);
  });

  it("mode non dit, réponse illisible ou proxy muet : jamais « réel » sur le coffre, et le panneau le dit en mots", async () => {
    for (const [mode, status] of [[{ vault: "unknown" }, 200], [{ vault: "chain", extra: 1 }, 200], [{ vault: "mainnet" }, 200], ["fake", 200], [{}, 404]] as const) {
      const view = render(<App client={realClient(mode, [], status)} />);
      await waitFor(async () => expect((await puce()).getAttribute("data-env")).toBe("non-confirme"));
      expect(text(await puce())).toContain("Origine non confirmée");
      await screen.findAllByTestId("decision");
      for (const title of ["Montant plaçable", "Décisions du contrat"]) {
        expect(tagOf(title)).toContain("origine non confirmée");
        expect(tagOf(title)).not.toContain("réel");
        // Seule exception visible sur le panneau : le mot, en petit.
        const tag = screen.getByRole("heading", { name: title }).parentElement!.querySelector(".source")!;
        expect(tag.querySelector(".source-mot")?.textContent).toBe("origine non confirmée");
      }
      expect(origines().vault).toBe("origine non confirmée");
      view.unmount();
    }
  });

  it("le mode se lit par un GET sur l'origine de la page ; rien n'est demandé au relais en plus", async () => {
    const calls: Call[] = [];
    render(<App client={realClient({ vault: "fake" }, calls)} />);
    await waitFor(async () => expect((await puce()).getAttribute("data-env")).toBe("coffre-simule"));
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

  it("monde simulé par les fixtures : puce « Démo · données fictives », provenance « simulation »", async () => {
    renderScenario("1");
    await screen.findAllByTestId("decision");
    expect((await puce()).getAttribute("data-env")).toBe("demo");
    expect(text(await puce())).toBe("Démo · données fictives, voir les sources");
    expect(tagOf("Montant plaçable")).toMatch(/^Source : coffre, simulation, lu à /);
    expect(origines()).toEqual({ relay: "simulation", vault: "simulation", response: "simulation" });
  });

  it("aucun panneau n'écrit « réel » ou « simulation » à l'écran : le mot est dans l'infobulle", async () => {
    renderScenario("1");
    await screen.findAllByTestId("decision");
    for (const tag of document.querySelectorAll<HTMLElement>(".carte-entete .source")) {
      const visible = [...tag.childNodes].filter((n) => !(n instanceof HTMLElement && (n.classList.contains("visuellement-cache") || n.tagName === "svg")));
      expect(visible.map((n) => n.textContent).join("")).toBe("");
      expect(tag.getAttribute("title")).toMatch(/^Source : /);
    }
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
