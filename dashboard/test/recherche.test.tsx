// Recherche de la barre haute : un filtre local, sans requête réseau.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { buildWorld } from "../fixtures/scenarios.ts";
import { fixture } from "../fixtures/sim.ts";
import type { Libelle } from "../src/api/types.ts";
import { agentsRetenus, fournisseursRetenus, normaliser, rechercher, trouvailles } from "../src/domain/recherche.ts";
import { renderScenario, startOfScript, text, type Call } from "./helpers.tsx";

const events = () => buildWorld("1", startOfScript()).events;
const libelles = new Map<string, Libelle>([
  [fixture("B-001"), { id: fixture("B-001"), genre: "beneficiaire", libelle: "Transports Bellec", siren: "812 447 906", iban_masque: "FR76 •••• 4021" }],
  [fixture("F-002"), { id: fixture("F-002"), genre: "facture", libelle: "FB-2026-1183", sous_titre: "Facture FB-2026-1183" }],
  [fixture("A-DEM-1"), { id: fixture("A-DEM-1"), genre: "agent", libelle: "AP-Factures-01" }],
]);

describe("recherche, domaine", () => {
  it("sans accents, sans casse, sans espaces", () => {
    expect(normaliser("Trésorerie Placements")).toBe("tresorerieplacements");
    expect(normaliser("812 447 906")).toBe("812447906");
  });

  it("trouve un fournisseur par son nom, son SIREN ou la fin de son IBAN masqué ; une facture mène à son fournisseur", () => {
    const items = trouvailles(events(), libelles);
    expect(rechercher(items, "bellec").map((i) => i.nom)).toEqual(["Transports Bellec"]);
    expect(rechercher(items, "812447").map((i) => i.nom)).toEqual(["Transports Bellec"]);
    expect(rechercher(items, "4021").map((i) => i.nom)).toEqual(["Transports Bellec"]);
    expect(rechercher(items, "  ")).toEqual([]);
    // F-002 est inscrite pour B-002 : la saisie de la facture retient son fournisseur.
    expect([...(fournisseursRetenus(items, "FB-2026") ?? [])]).toEqual([fixture("B-002")]);
    expect(fournisseursRetenus(items, "")).toBeNull();
    expect([...(agentsRetenus(items, "ap-factures") ?? [])]).toEqual([fixture("A-DEM-1")]);
  });

  it("un identifiant sans libellé se trouve par sa forme abrégée", () => {
    const items = trouvailles(events(), new Map());
    const id = fixture("B-002");
    expect(rechercher(items, id.slice(-4)).some((i) => i.id === id)).toBe(true);
  });
});

describe("recherche, interface", () => {
  it("filtre local : aucune requête ne porte la saisie ; choisir ouvre l'écran filtré, Effacer le rétablit", async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderScenario("1", { calls });
    await screen.findAllByTestId("decision");
    const input = screen.getByTestId("recherche");
    await user.type(input, "fictif b");
    const list = screen.getByTestId("recherche-resultats");
    await waitFor(() => expect(list.hidden).toBe(false));
    expect(text(list)).toContain("Fournisseur fictif B");
    expect(calls.some((c) => /fictif/i.test(decodeURIComponent(c.url)))).toBe(false);
    expect(calls.every((c) => c.method === "GET")).toBe(true);

    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Fournisseurs", current: "page" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId("fournisseur")).toHaveLength(1));
    expect(text(screen.getByTestId("filtre-note"))).toMatch(/^1 sur 3 pour « Fournisseur fictif B »/);
    await user.click(screen.getByRole("button", { name: "Effacer la recherche" }));
    expect(screen.getAllByTestId("fournisseur")).toHaveLength(3);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("aucune trouvaille : une phrase, pas une liste vide", async () => {
    const user = userEvent.setup();
    renderScenario("1");
    await screen.findAllByTestId("decision");
    await user.type(screen.getByTestId("recherche"), "zzz");
    expect(text(screen.getByTestId("recherche-resultats"))).toBe("Aucun fournisseur, facture ou agent ne correspond.");
  });
});
