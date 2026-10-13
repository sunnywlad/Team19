// Composants partagés du système Veto : la table ronde ne montre que des faits,
// la pastille porte ses trois signes, le bandeau n'affiche jamais 0 pour une
// valeur non lue, et rien ici n'est un bouton.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { JournalEntry, PausedAgent, RelayDecision, RelayEvent, VaultState } from "../src/api/types.ts";
import { BandeauTresorerie } from "../src/components/veto/BandeauTresorerie.tsx";
import { BlocASigner } from "../src/components/veto/BlocASigner.tsx";
import { EtiquetteSource } from "../src/components/veto/EtiquetteSource.tsx";
import { PastilleDecision } from "../src/components/veto/PastilleDecision.tsx";
import { TableRonde } from "../src/components/veto/TableRonde.tsx";
import { contractOutcome, gatewayOutcome } from "../src/domain/flow.ts";
import { describeSeats, seatsFor } from "../src/domain/table.ts";
import { treasuryOf } from "../src/domain/tresorerie.ts";
import { text } from "./helpers.tsx";

/** Texte de chaque enfant direct, séparé : les éléments voisins n'ont pas d'espace entre eux. */
const parts = (element: Element): string => [...element.children].map(text).join(" | ");

const ID = (n: number): string => `0x${n.toString(16).padStart(64, "0")}`;

function decision(decisionCode: number, reason: number): RelayDecision {
  return {
    id: 1,
    request_id: ID(1),
    agent_id: ID(2),
    client_id: ID(3),
    action: 1,
    decision: decisionCode,
    reason,
    reason_name: null,
    effective_decision: decisionCode,
    ref_id: ID(4),
    tx_hash: ID(5),
    log_index: 0,
    block_number: 10,
    block_timestamp: 1_800_000_000,
  };
}

function entry(type: string, data: Record<string, unknown>): JournalEntry {
  return { v: 1, seq: 7, ts_ms: 1_800_000_000_000, type, component: "GATEWAY", request_id: ID(1), agent_id: null, client_id: null, data, prev_hash: ID(8), hash: ID(9) };
}

const states = (d: RelayDecision): string => seatsFor(contractOutcome(d, null)).map((s) => `${s.key}:${s.state}${s.code ? `(${s.code})` : ""}`).join(" ");

describe("table ronde : états des sièges", () => {
  it("sans issue : cinq sièges au repos", () => {
    expect(seatsFor(null).map((s) => s.state)).toEqual(["repos", "repos", "repos", "repos", "repos"]);
  });

  it("payé directement : le contrat a statué, l'humain n'a pas été sollicité", () => {
    expect(states(decision(2, 0))).toBe("porte:passe ia:passe relais:passe contrat:passe(NONE) humain:repos");
  });

  it("validation humaine : le contrat a renvoyé, l'humain est en attente", () => {
    expect(states(decision(1, 10))).toBe("porte:passe ia:passe relais:passe contrat:passe(ABOVE_THRESHOLD) humain:attente");
  });

  it("approuvé, refusé par l'approbateur, délai dépassé : c'est le siège de l'humain qui porte le motif", () => {
    expect(states(decision(2, 13))).toBe("porte:passe ia:passe relais:passe contrat:passe humain:passe(APPROVED)");
    expect(states(decision(0, 12))).toBe("porte:passe ia:passe relais:passe contrat:passe humain:veto(APPROVAL_REFUSED)");
    expect(states(decision(0, 11))).toBe("porte:passe ia:passe relais:passe contrat:passe humain:veto(APPROVAL_TIMEOUT)");
  });

  it("veto du contrat : l'humain n'est pas atteint", () => {
    expect(states(decision(0, 2))).toBe("porte:passe ia:passe relais:passe contrat:veto(INVOICE_ALREADY_PAID) humain:non-atteint");
  });

  it("motif inconnu, ou décision qui ne va pas avec son motif : veto du contrat, sans code inventé", () => {
    expect(states(decision(2, 77))).toBe("porte:passe ia:passe relais:passe contrat:veto humain:non-atteint");
    // Décision 2 annoncée avec un motif de refus : jamais « payé ».
    expect(states(decision(2, 1))).toBe("porte:passe ia:passe relais:passe contrat:veto(INVOICE_UNKNOWN) humain:non-atteint");
  });

  it("arrêt à la porte : veto de la porte, les quatre autres non atteints", () => {
    const blocked = gatewayOutcome(entry("DETECTION", { verdict: "BLOCK", reason_codes: ["INSTRUCTION_IN_DATA"] }), null);
    expect(seatsFor(blocked).map((s) => `${s.state}${s.code ? `(${s.code})` : ""}`)).toEqual(["veto(INSTRUCTION_IN_DATA)", "non-atteint", "non-atteint", "non-atteint", "non-atteint"]);
    const rejected = gatewayOutcome(entry("AUTH_REJECTED", { cause: "TOKEN_UNKNOWN" }), null);
    expect(seatsFor(rejected)[0]).toMatchObject({ state: "veto", code: "AUTH_REJECTED" });
  });

  it("un code de raison qui n'a pas la forme d'un code n'est jamais repris", () => {
    const odd = gatewayOutcome(entry("DETECTION", { verdict: "BLOCK", reason_codes: ["<img src=x onerror=1>"] }), null);
    expect(seatsFor(odd)[0]?.code).toBe("DETECTION");
  });
});

describe("table ronde : rendu", () => {
  it("chaque siège est dit en mots, avec le code sur celui qui a statué", () => {
    const seats = seatsFor(contractOutcome(decision(0, 2), null));
    render(<TableRonde seats={seats} fresh="contrat" />);
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Table ronde : Porte d'entrée passé, IA du client passé, Relais passé, Contrat veto, Humain non atteint",
    );
    expect(describeSeats(seats)).toBe(screen.getByRole("img").getAttribute("aria-label"));
    expect(parts(screen.getByTestId("siege-contrat"))).toBe("Contrat | Veto | INVOICE_ALREADY_PAID");
    expect(parts(screen.getByTestId("siege-humain"))).toBe("Humain | Non atteint");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    // Cinq sièges dessinés, dans l'ordre du flux ; seul le siège qui vient de changer est animé.
    const drawn = [...document.querySelectorAll("g.siege")].map((g) => g.getAttribute("class"));
    expect(drawn).toEqual(["siege siege-passe", "siege siege-passe", "siege siege-passe", "siege siege-veto siege-nouveau", "siege siege-non-atteint"]);
  });

  it("au repos : aucun glyphe, aucun code", () => {
    render(<TableRonde seats={seatsFor(null)} />);
    expect(document.querySelectorAll(".siege-glyphe")).toHaveLength(0);
    expect(document.querySelectorAll(".table-legende code")).toHaveLength(0);
  });
});

describe("pastille de décision", () => {
  it("chiffre, glyphe et mot pour 0, 1 et 2 ; pas de chiffre pour l'arrêt à la porte", () => {
    render(
      <>
        <PastilleDecision tone="refuse" />
        <PastilleDecision tone="humain" />
        <PastilleDecision tone="accepte" large />
        <PastilleDecision tone="bloque" />
      </>,
    );
    const pills = screen.getAllByTestId("pastille-decision");
    expect(pills.map(text)).toEqual(["0Refusé", "1Validation humaine", "2Payé", "Arrêté à la porte"]);
    for (const pill of pills) expect(pill.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(pills[2]?.className).toContain("veto-decision-grand");
  });
});

describe("étiquette de source", () => {
  it("dit la source en mots, jamais « réel » par défaut", () => {
    const { container } = render(
      <>
        <EtiquetteSource kind="source" source="reel" />
        <EtiquetteSource kind="source" source="simulation" />
        <EtiquetteSource kind="source" source="faux-coffre" />
        <EtiquetteSource kind="source" source="non-confirme" />
        <EtiquetteSource kind="non-mesure" />
        <EtiquetteSource kind="lecture" from="relais" lastOkAt={null} />
      </>,
    );
    expect([...container.querySelectorAll(".veto-source")].map(text)).toEqual(["réel", "simulation", "simulation", "origine non confirmée", "non mesuré", "relais · jamais lu"]);
  });

  it("lecture datée : d'où, et à quelle heure", () => {
    render(<EtiquetteSource kind="lecture" from="relais" lastOkAt={Date.UTC(2026, 9, 13, 12, 12, 0)} />);
    expect(screen.getByText(/^relais · lu \d{2}:\d{2}/)).toBeTruthy();
  });
});

describe("bandeau de trésorerie", () => {
  const paid = (amount: unknown, id: number): RelayEvent => ({ id, name: "Paid", tx_hash: ID(id), log_index: 0, block_number: id, block_timestamp: 1_800_000_000, request_id: ID(id), args: { amount: amount as string } });
  const vault = (held: string | null, paused: boolean | null): VaultState => ({
    block_number: 1,
    block_timestamp: 1_800_000_000,
    cash_wei: null,
    admitted_debts_wei: null,
    safety_reserve_wei: null,
    total_held_wei: held,
    held_placements_wei: null,
    placeable_wei: null,
    threshold_wei: null,
    vault_paused: paused,
  });
  const agent: PausedAgent = { agent_id: ID(2), scope: "OFFCHAIN", incident_id: null, paused_at_ms: 1 };
  const cell = (id: string): string => parts(screen.getByTestId(id));

  it("montants lus, chacun avec son état en mots", () => {
    const other: RelayEvent = { ...paid("1", 9), name: "HoldPlaced" };
    render(<BandeauTresorerie treasury={treasuryOf([paid("10000000000000000", 1), paid("20000000000000000", 2), other], vault("30000000000000000", false), [agent])} />);
    expect(cell("tresor-sorti")).toBe("Montant sorti | 30u | 2 paiements lus, sur réseau de test");
    expect(cell("tresor-bloque")).toBe("Montant bloqué | 30u | En attente d'un humain");
    expect(cell("tresor-agents")).toBe("Agents en pause | 1 | Écarté par le service de réponse");
    expect(cell("tresor-coffre")).toBe("Coffre | Actif | Non en pause");
    expect(screen.getByTestId("bandeau-tresorerie").getAttribute("data-perime")).toBe("false");
  });

  it("rien n'est sorti, rien n'est bloqué : des zéros lus, pas des absences", () => {
    render(<BandeauTresorerie treasury={treasuryOf([], vault("0", true), [])} stale />);
    expect(cell("tresor-sorti")).toBe("Montant sorti | 0u | Aucun paiement lu");
    expect(cell("tresor-bloque")).toBe("Montant bloqué | 0u | Rien n'attend un humain");
    expect(cell("tresor-agents")).toBe("Agents en pause | 0 | Aucun agent écarté");
    expect(cell("tresor-coffre")).toBe("Coffre | En pause | Aucune sortie possible");
    expect(screen.getByTestId("bandeau-tresorerie").getAttribute("data-perime")).toBe("true");
  });

  it("valeur non lue : « Non mesuré », jamais 0", () => {
    render(<BandeauTresorerie treasury={treasuryOf(null, null, null)} />);
    for (const id of ["tresor-sorti", "tresor-bloque", "tresor-agents", "tresor-coffre"]) {
      expect(cell(id)).toContain("Non mesuré");
      expect(cell(id)).not.toMatch(/\b0\b/);
    }
  });

  it("un montant payé illisible : pas de total partiel", () => {
    const treasury = treasuryOf([paid("10000000000000000", 1), paid("abc", 2), paid(12, 3)], vault("0", false), []);
    expect(treasury).toMatchObject({ paidWei: null, paidCount: 3 });
    render(<BandeauTresorerie treasury={treasury} />);
    expect(cell("tresor-sorti")).toBe("Montant sorti | Non mesuré | Un montant payé est illisible");
  });
});

describe("bloc « à signer »", () => {
  it("rappelle que la signature se fait hors dashboard, sans champ ni bouton", () => {
    render(<BlocASigner />);
    const block = screen.getByTestId("a-signer");
    expect(text(block)).toContain("À signer par l'approbateur, hors dashboard.");
    expect(block.querySelectorAll("button, input, a, [role='button'], [tabindex]")).toHaveLength(0);
  });
});
