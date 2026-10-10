import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { IncidentReport, VaultState } from "../src/api/types.ts";
import { PlaceableValues } from "../src/components/PlaceablePanel.tsx";
import { computeDelays } from "../src/domain/delays.ts";
import { abbreviateId, formatDurationMs, formatWei } from "../src/lib/format.ts";
import { parse } from "../src/validation/validate.ts";
import { text } from "./helpers.tsx";

const here = dirname(fileURLToPath(import.meta.url));
const specs = (path: string): string => join(here, "../../specs", path);
const json = (path: string): unknown => JSON.parse(readFileSync(specs(path), "utf8"));

describe("mise en forme", () => {
  it("abrège un identifiant opaque, et seulement un identifiant opaque", () => {
    expect(abbreviateId("0x4c399b1cfd777c598778cfcdefdea719b040cc331ac368cba4957cb221ab7376")).toBe("0x4c39…7376");
    expect(abbreviateId("8228e159707bd77f2a8e55fc03cec36baed91908b0a6340b8eeda0aba908815c")).toBe("8228…815c");
    expect(abbreviateId("Jean Dupont")).toBeNull();
    expect(abbreviateId("<img onerror=1>")).toBeNull();
  });

  it("un montant absent ou mal formé n'est jamais lu comme 0", () => {
    expect(formatWei("20000000000000000")).toBe("20");
    expect(formatWei("0")).toBe("0");
    expect(formatWei("1500000000000000")).toBe("1,5");
    expect(formatWei("1234567000000000000000")).toBe("1 234 567");
    for (const bad of [null, undefined, "", "abc", "-5", "1e18", "007", "1.5"]) expect(formatWei(bad)).toBeNull();
    expect(formatDurationMs(41)).toBe("41 ms");
    expect(formatDurationMs(1480)).toBe("1,48 s");
  });

  it("plaçable manquant : « non disponible », aucun recalcul à partir des autres termes", () => {
    const vault: VaultState = {
      block_number: 12, block_timestamp: 1791662523, cash_wei: "100000000000000000", admitted_debts_wei: "40000000000000000",
      safety_reserve_wei: "40000000000000000", total_held_wei: null, held_placements_wei: "0", placeable_wei: null, threshold_wei: null, vault_paused: null,
    };
    render(<PlaceableValues vault={vault} />);
    expect(text(screen.getByTestId("placable"))).toBe("non disponible");
    expect(text(screen.getByTestId("bloque"))).toBe("non disponible");
    expect(text(screen.getByTestId("cash"))).toBe("100 u");
  });
});

describe("délais", () => {
  const report = json("examples/incident/valid/02-scenario-4-refus-du-contrat.json") as IncidentReport;
  const gateway = json("examples/incident/valid/01-scenario-3-porte-entree.json") as IncidentReport;

  it("porte d'entrée : trois délais sur l'horloge du journal", () => {
    expect(computeDelays(gateway).map((d) => [d.key, d.value, d.clock])).toEqual([
      ["arrivee-detection", 41, "journal"],
      ["detection-pause", 11, "journal"],
      ["detection-alerte", 20, "journal"],
    ]);
  });

  it("contrat : aucune durée entre une heure de bloc et une heure de journal", () => {
    const delays = computeDelays(report, report.contract ? report.contract.block_timestamp + 4 : null);
    const byKey = Object.fromEntries(delays.map((d) => [d.key, d]));
    expect(byKey["arrivee-detection"]?.value).toBeNull();
    expect(byKey["detection-pause"]?.note).toBe("non calculé : horloges différentes (bloc → journal)");
    expect(byKey["observation-pause"]).toMatchObject({ value: 11, clock: "journal" });
    expect(byKey["arrivee-observation"]).toMatchObject({ value: 4480, clock: "journal" });
    expect(byKey["decision-pause-chaine"]).toMatchObject({ value: 4, clock: "bloc" });
    for (const d of delays) expect(d.value === null ? d.clock : d.note).toBeNull();
  });

  it("horodatage manquant ou fin avant le début : pas de durée", () => {
    const broken: IncidentReport = { ...gateway, timestamps: { ...gateway.timestamps, paused_at_ms: gateway.timestamps.detected_at_ms - 5, alerted_at_ms: null } };
    const [, pause, alert] = computeDelays(broken);
    expect(pause).toMatchObject({ value: null, note: "incohérent : la fin précède le début" });
    expect(alert).toMatchObject({ value: null, note: "non disponible" });
  });
});

describe("validation contre les schémas de specs/", () => {
  const manifest = (dir: string): { file: string; expect: string }[] => (json(`examples/${dir}/manifest.json`) as { cases: { file: string; expect: string }[] }).cases;

  it("rapports d'incident : les exemples valides passent, les exemples hors schéma sont rejetés", () => {
    for (const c of manifest("incident")) {
      const data = json(`examples/incident/${c.file}`);
      if (c.expect === "schema-invalid") expect(() => parse.incidentReport(data), c.file).toThrow(/non conforme au schéma/);
      else expect(parse.incidentReport(data), c.file).toBe(data);
    }
  });

  it("journal : chaque entrée de la chaîne valide passe, les exemples hors schéma sont rejetés", () => {
    const lines = readFileSync(specs("examples/journal/chaine-valide.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as unknown);
    expect(parse.journalEntries(lines)).toHaveLength(lines.length);
    for (const file of readdirSync(specs("examples/journal/invalid"))) {
      expect(() => parse.journalEntry(json(`examples/journal/invalid/${file}`)), file).toThrow(/non conforme au schéma/);
    }
  });

  it("le message d'erreur donne le chemin et la règle, jamais la valeur reçue", () => {
    expect(() => parse.relayStatus({ next_block: "<script>alert(1)</script>", confirmations: 1, events: 0 })).toThrow(
      "état de l'indexeur : réponse non conforme au schéma (/next_block : pattern)",
    );
  });
});

describe("règle de lint", () => {
  const lint = join(here, "../tools/lint.mjs");

  it("passe sur le dépôt", () => {
    expect(execFileSync(process.execPath, [lint], { encoding: "utf8" })).toContain("aucune infraction");
  });

  it.each([
    ["dangerouslySetInnerHTML", "export const X = () => <p dangerouslySetInnerHTML={{ __html: a }} />;"],
    ["innerHTML", "el.innerHTML = value;"],
    ["URL construite", "export const X = ({ u }) => <a href={u}>lien</a>;"],
    ["méthode autre que GET", 'fetch("/api/relay/x", { method: "POST" });'],
    ["ressource externe", 'const font = "https://fonts.example/x.woff2";'],
    ["variable publique", "const k = import.meta.env.VITE_TOKEN;"],
  ])("échoue sur : %s", (_name, source) => {
    const dir = mkdtempSync(join(tmpdir(), "lint-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "bad.tsx"), `${source}\n`);
    const run = spawnSync(process.execPath, [lint, dir], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("src/bad.tsx:1");
  });
});
