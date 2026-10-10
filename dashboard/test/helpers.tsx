import { render } from "@testing-library/react";
import { handleFixtureRequest } from "../fixtures/handler.ts";
import { buildWorld, type ScenarioName } from "../fixtures/scenarios.ts";
import type { World } from "../fixtures/sim.ts";
import { SimulatedApiClient, type ApiClient } from "../src/api/client.ts";
import type { FetchLike } from "../src/api/http.ts";
import { App } from "../src/App.tsx";

export type Call = { method: string; url: string };

export type FetchOptions = {
  calls?: Call[];
  /** Modifie le corps d'une réponse avant de la servir : pour injecter une donnée hostile. */
  tamper?: (path: string, body: unknown) => unknown;
  /** true : l'API est coupée. */
  down?: () => boolean;
};

/** Un fetch qui sert le monde simulé par les mêmes routes que le serveur de fixtures. */
export function fixtureFetch(world: () => World, options: FetchOptions = {}): FetchLike {
  return async (input, init) => {
    const method = init.method ?? "GET";
    options.calls?.push({ method, url: input });
    if (options.down?.()) throw new TypeError("fetch failed");
    const path = input.replace(/^\/api\/(relay|simulation|reponse)/, "");
    const reply = handleFixtureRequest(world(), method, path);
    const cloned: unknown = JSON.parse(JSON.stringify(reply.body));
    const body = options.tamper ? options.tamper(path, cloned) : cloned;
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => body } as Response;
  };
}

/** Début du script : assez récent pour qu'une échéance à 30 s soit encore à venir. */
export const startOfScript = (): number => Date.now() - 5000;

export function scenarioClient(name: ScenarioName, options: FetchOptions & { t0?: number; now?: number } = {}): ApiClient {
  const t0 = options.t0 ?? startOfScript();
  return new SimulatedApiClient(fixtureFetch(() => buildWorld(name, t0, options.now), options));
}

export function renderScenario(name: ScenarioName, options: FetchOptions & { t0?: number; now?: number } = {}) {
  return render(<App client={scenarioClient(name, options)} />);
}

export const text = (element: Element): string => (element.textContent ?? "").replace(/\s+/g, " ").trim();
