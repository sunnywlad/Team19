// Scénario « pitch » (make pitch) : données fictives conformes aux schémas,
// chiffres dans des bornes attendues, libellés fictifs, garde-fou contre un
// démarrage mixte. Le monde est construit à plusieurs dates : ses volumes
// dépendent du calendrier (jours ouvrés, heure du lancement).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { handleFixtureRequest } from "../fixtures/handler.ts";
import { LIBELLES_PITCH_FILE, libellesPitchText } from "../fixtures/libelles-pitch.ts";
import { AGENTS, agentId } from "../fixtures/pitch.ts";
import { buildWorld } from "../fixtures/scenarios.ts";
import { toDecisions, type World } from "../fixtures/sim.ts";
import { dailyStats } from "../fixtures/stats.ts";
import { RealApiClient, SimulatedApiClient } from "../src/api/client.ts";
import type { FetchLike } from "../src/api/http.ts";
import { App } from "../src/App.tsx";
import { latestIncidents } from "../src/domain/activity.ts";
import { statsSummary } from "../src/domain/apercu.ts";
import { parse } from "../src/validation/validate.ts";
import viteConfig, { PITCH, pitchConflicts } from "../vite.config.ts";
import { fixtureFetch, text, type Call } from "./helpers.tsx";

const LIBELLES_PITCH: unknown = JSON.parse(readFileSync(LIBELLES_PITCH_FILE, "utf8"));

/** Lancements à des jours et des heures variés : lundi matin, mercredi midi, samedi soir, dimanche à l'aube… */
const LAUNCHES = [new Date(2026, 9, 5, 7, 30), new Date(2026, 9, 7, 13, 5), new Date(2026, 9, 10, 22, 40), new Date(2026, 9, 18, 5, 10)].map((d) => d.getTime());

const worlds = new Map<number, World>();
const worldAt = (t0: number): World => {
  let w = worlds.get(t0);
  if (!w) worlds.set(t0, (w = buildWorld("pitch", t0)));
  return w;
};

const get = (world: World, url: string, now: number) => {
  const reply = handleFixtureRequest(world, "GET", url, now);
  expect(reply.status, url).toBe(200);
  return reply.body;
};

/** Luhn : vrai pour tout SIREN attribué. Un SIREN fictif doit l'échouer. */
function luhn(siren: string): boolean {
  const digits = siren.replace(/ /g, "").split("").reverse().map(Number);
  return digits.reduce((acc, d, i) => acc + (i % 2 === 1 ? (d * 2 > 9 ? d * 2 - 9 : d * 2) : d), 0) % 10 === 0;
}

describe("scénario pitch : formes", () => {
  it("chaque point d'accès sert une réponse conforme à son schéma, listes récentes comprises", () => {
    const t0 = LAUNCHES[1]!;
    const world = worldAt(t0);
    parse.relayStatus(get(world, "/status", t0));
    parse.relayDecisions(get(world, "/decisions?order=desc&limit=500", t0));
    parse.relayEvents(get(world, "/events?order=desc&limit=500", t0));
    parse.relayEvents(get(world, "/events?name=BeneficiaryRegistered&order=desc&limit=500", t0));
    parse.relayQueue(get(world, "/queue?limit=500", t0));
    parse.vaultState(get(world, "/vault", t0));
    parse.incidents(get(world, "/incidents", t0));
    parse.journalEntries(get(world, "/journal/entries?limit=500", t0));
    parse.journalVerification(get(world, "/journal/verification", t0));
    parse.pausedAgents(get(world, "/agents/paused", t0));
    const stats = parse.dailyStats(get(world, "/stats/daily", t0));
    expect(stats.days).toHaveLength(30);
  });

  it("order=desc : les plus récents d'abord ; une autre valeur est refusée", () => {
    const t0 = LAUNCHES[1]!;
    const world = worldAt(t0);
    const desc = get(world, "/events?order=desc&limit=3", t0) as { id: number }[];
    expect(desc.map((e) => e.id)).toEqual([world.events.length, world.events.length - 1, world.events.length - 2]);
    const asc = get(world, "/events?limit=2", t0) as { id: number }[];
    expect(asc.map((e) => e.id)).toEqual([1, 2]);
    expect(handleFixtureRequest(world, "GET", "/events?order=random", t0).status).toBe(400);
  });

  it("toutes les étapes sont dans le passé ; les échéances des trois demandes en attente tombent entre 2 et 20 h", () => {
    for (const t0 of LAUNCHES) {
      const world = worldAt(t0);
      expect(Math.max(...world.events.map((e) => e.block_timestamp * 1000))).toBeLessThan(t0);
      expect(Math.max(...world.journal.map((e) => e.ts_ms))).toBeLessThan(t0);
      const current = new Map(toDecisions(world.events).map((d) => [d.request_id, d]));
      const pending = [...current.values()].filter((d) => d.decision === 1);
      expect(pending).toHaveLength(3);
      for (const d of pending) {
        const hold = world.events.find((e) => e.name === "HoldPlaced" && e.request_id === d.request_id)!;
        const hours = (Number(hold.args.deadline) * 1000 - t0) / 3_600_000;
        expect(hours).toBeGreaterThanOrEqual(2);
        expect(hours).toBeLessThanOrEqual(20);
      }
    }
  });
});

describe("scénario pitch : chiffres", () => {
  it("vue d'ensemble dans les bornes, quel que soit le jour du lancement", () => {
    for (const t0 of LAUNCHES) {
      const world = worldAt(t0);
      const summary = statsSummary(dailyStats(world, t0));
      expect(summary.days).toBe(30);
      expect(summary.paid.count, "paiements").toBeGreaterThanOrEqual(950);
      expect(summary.paid.count, "paiements").toBeLessThanOrEqual(1250);
      expect(summary.approved, "payés après validation").toBeGreaterThan(0);
      expect(summary.share!, "part sans intervention").toBeGreaterThan(0.9);
      expect(summary.blocked.count, "bloqués").toBeGreaterThanOrEqual(25);
      expect(summary.blocked.count, "bloqués").toBeLessThanOrEqual(40);
      expect(summary.gate, "à la porte").toBe(2);

      // Montants des paiements : 500 € à 60 000 € (1 € = 10¹⁵ wei).
      for (const e of world.events.filter((x) => x.name === "Paid")) {
        const eur = Number(BigInt(String(e.args.amount)) / 10n ** 13n) / 100;
        expect(eur).toBeGreaterThanOrEqual(500);
        expect(eur).toBeLessThanOrEqual(60_000);
      }

      // 5 incidents, dont 2 ouverts ; 4 agents, dont 1 en pause.
      const incidents = latestIncidents(world.incidents);
      expect(incidents).toHaveLength(5);
      expect(incidents.filter((i) => i.report.human_decision === null)).toHaveLength(2);
      expect(world.events.filter((e) => e.name === "AgentRegistered")).toHaveLength(4);
      expect(new Set(world.pausedAgents.map((p) => p.agent_id))).toEqual(new Set([agentId("AP-02")]));
    }
  });

  it("agrégats = mêmes définitions que la console, sur tous les événements", () => {
    const t0 = LAUNCHES[2]!;
    const world = worldAt(t0);
    const paid = world.events.filter((e) => e.name === "Paid" && e.block_timestamp * 1000 > t0 - 29 * 86_400_000);
    const summary = statsSummary(dailyStats(world, t0));
    // Les 30 jours civils couvrent au moins les 29 derniers jours glissants.
    expect(summary.paid.count).toBeGreaterThanOrEqual(paid.length);
  });
});

describe("libellés du pitch", () => {
  it("le fichier commité est celui que génère le catalogue, et passe le schéma", () => {
    expect(readFileSync(LIBELLES_PITCH_FILE, "utf8")).toBe(libellesPitchText());
    const file = parse.libelles(LIBELLES_PITCH);
    expect(file.libelles.length).toBeLessThanOrEqual(2000);
  });

  it("noms de la maquette ; IBAN masqués ; SIREN fictifs, à clé de Luhn fausse", () => {
    const rows = parse.libelles(LIBELLES_PITCH).libelles;
    const names = rows.filter((r) => r.genre === "beneficiaire").map((r) => r.libelle);
    for (const name of ["Transports Bellec", "Nordlog Services", "Imprimerie Vasseur", "Cabinet Arvel", "Atelier Moreau", "Studio Lumen", "Logistique Duroc", "Papeterie du Centre"]) {
      expect(names).toContain(name);
    }
    expect(rows.filter((r) => r.genre === "agent").map((r) => r.libelle)).toEqual(AGENTS.map((a) => a.libelle));
    const sirens = rows.flatMap((r) => (r.siren ? [r.siren] : []));
    expect(sirens.length).toBe(8);
    for (const siren of sirens) expect(luhn(siren), siren).toBe(false);
    for (const row of rows) if (row.iban_masque) expect(row.iban_masque).toContain("••••");
    expect(rows.find((r) => r.genre === "client")?.libelle).toBe("Aubert Industrie");
  });

  it("chaque fournisseur, agent et facture du monde est nommé", () => {
    const world = worldAt(LAUNCHES[0]!);
    const named = new Set(parse.libelles(LIBELLES_PITCH).libelles.map((r) => r.id));
    for (const e of world.events) {
      const id = e.name === "BeneficiaryRegistered" ? e.args.beneficiaryId : e.name === "AgentRegistered" ? e.args.agentId : e.name === "InvoiceRegistered" ? e.args.invoiceId : null;
      if (id !== null) expect(named.has(String(id)), `${e.name} ${String(id)}`).toBe(true);
    }
  });
});

describe("garde-fou : jamais de réel à côté du fictif", () => {
  it("le proxy nomme chaque variable réelle définie, sans sa valeur", () => {
    expect(pitchConflicts({})).toEqual([]);
    expect(pitchConflicts({ RELAY_API_URL: "  " })).toEqual([]);
    expect(pitchConflicts({ RELAY_API_URL: "http://127.0.0.1:8787", RELAY_HAS_VAULT: "1", RESPONSE_API_URL: "http://x" })).toEqual([
      "RELAY_API_URL",
      "RESPONSE_API_URL",
      "RELAY_HAS_VAULT",
    ]);
  });

  it("le proxy refuse de démarrer en mode pitch avec une variable réelle", () => {
    const config = viteConfig as unknown as (env: { mode: string; command: string; isPreview: boolean }) => { server: { port: number } };
    const saved = { ...process.env };
    try {
      process.env.DASHBOARD_PITCH = "1";
      for (const name of ["RELAY_API_URL", "RESPONSE_API_URL", "RELAY_HAS_VAULT"]) {
        process.env[name] = name === "RELAY_HAS_VAULT" ? "1" : "http://127.0.0.1:9";
        expect(() => config({ mode: "test-pitch", command: "serve", isPreview: false })).toThrow(new RegExp(`mode pitch refusé : ${name}`));
        delete process.env[name];
      }
      expect(config({ mode: "test-pitch", command: "serve", isPreview: false }).server.port).toBe(PITCH.port);
    } finally {
      process.env = saved;
    }
  });

  it("make pitch refuse un démarrage mixte avant de lancer quoi que ce soit", () => {
    for (const name of ["RELAY_API_URL", "RESPONSE_API_URL", "RELAY_HAS_VAULT"]) {
      const run = spawnSync("bash", [join(process.cwd(), "tools", "pitch.sh")], { env: { PATH: process.env.PATH, [name]: "1" }, encoding: "utf8", timeout: 10_000 });
      expect(run.status, name).toBe(2);
      expect(run.stderr).toContain(`refusé, ${name} défini`);
      expect(run.stderr).not.toContain("http");
    }
  });

  it("le client réel ne demande ni order=desc ni /stats/daily : le relais ne les sert pas", async () => {
    const calls: Call[] = [];
    const world = fixtureFetch(() => worldAt(LAUNCHES[0]!), { calls });
    const client = new RealApiClient({}, world);
    expect(client.recent).toBe(false);
    await client.getEvents();
    await client.getDecisions();
    await expect(client.getDailyStats()).rejects.toThrow(/non servis/);
    expect(calls.some((c) => c.url.includes("order=") || c.url.includes("/stats/"))).toBe(false);
  });
});

describe("écran du pitch", () => {
  it("vue d'ensemble en euros, chiffres des 30 jours, trois demandes à valider, puce « Démo · données fictives »", async () => {
    const t0 = Date.now();
    const world = buildWorld("pitch", t0);
    const fetchFn: FetchLike = fixtureFetch(() => world, { local: { libelles: LIBELLES_PITCH, unite: PITCH.unite } });
    render(<App client={new SimulatedApiClient(fetchFn)} />);
    await waitFor(() => expect(text(screen.getByTestId("kpi-payes"))).toMatch(/€$/), { timeout: 5000 });
    const summary = statsSummary(dailyStats(world, t0));
    expect(text(screen.getByTestId("kpi-payes").parentElement!)).toContain(`${summary.paid.count.toLocaleString("fr-FR")} paiements · 30 derniers jours`.replace(/\s/g, " "));
    expect(text(screen.getByTestId("kpi-valider"))).toBe("3");
    expect(text(screen.getByTestId("puce-env"))).toContain("Démo · données fictives");
    expect(text(screen.getByTestId("societe"))).toBe("Aubert Industrie Société fictive · démo");
    const attente = screen.getByRole("heading", { name: "En attente de votre décision" }).closest("section")!;
    await waitFor(() => expect(within(attente).getAllByTestId("sup-cas")).toHaveLength(3));
    expect(text(attente)).toContain("Transports Bellec");
    expect(text(attente)).toContain("48 600,00 €");
  });
});
