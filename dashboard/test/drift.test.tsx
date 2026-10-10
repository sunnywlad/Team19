// Dérive : la liste fermée des motifs de specs/02 § 7 fait foi. Chaque code a un
// libellé ici ; un code inconnu n'est pas fatal.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { REASONS, readDecision } from "../src/domain/reasons.ts";
import { renderScenario, text } from "./helpers.tsx";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(join(here, path), "utf8");

function specReasons(): { code: number; name: string; decision: number }[] {
  const section = read("../../specs/02-contrat.md").split("## 7. Motifs")[1]?.split("\n## ")[0] ?? "";
  return [...section.matchAll(/^\| (\d+) \| `([A-Z_]+)` \| ([012]) \|/gm)].map((m) => ({ code: Number(m[1]), name: String(m[2]), decision: Number(m[3]) }));
}

describe("motifs du contrat", () => {
  it("chaque motif de la liste fermée de specs/02 a un libellé, le bon nom et la bonne décision", () => {
    const spec = specReasons();
    expect(spec.length).toBeGreaterThanOrEqual(20);
    for (const { code, name, decision } of spec) {
      const local = REASONS[code];
      expect(local, `motif ${code} (${name}) sans libellé dans le dashboard`).toBeDefined();
      expect(local?.name).toBe(name);
      expect(local?.decision).toBe(decision);
      expect(local?.label.trim().length).toBeGreaterThan(3);
    }
    expect(Object.keys(REASONS).map(Number).sort((a, b) => a - b)).toEqual(spec.map((r) => r.code));
    expect(new Set(Object.values(REASONS).map((r) => r.label)).size).toBe(spec.length);
  });

  it("la liste du relais (relay/src/config.ts) est la même", () => {
    const block = read("../../relay/src/config.ts").split("export const REASON = {")[1]?.split("}")[0] ?? "";
    const relay = [...block.matchAll(/([A-Z_]+): (\d+),/g)].map((m) => [Number(m[2]), m[1]]);
    expect(relay).toEqual(Object.entries(REASONS).map(([code, r]) => [Number(code), r.name]));
  });

  it("un motif inconnu est lu comme un refus, quelle que soit la décision annoncée", () => {
    for (const decision of [0, 1, 2, 7]) {
      const read = readDecision({ decision, reason: 42, effective_decision: 0 });
      expect(read.kind).toBe("refuse");
      expect(read.reasonLabel).toBe("motif 42 inconnu, traité comme un refus");
    }
    expect(readDecision({ decision: 2, reason: 0, effective_decision: 2 }).kind).toBe("accepte");
    expect(readDecision({ decision: 1, reason: 10, effective_decision: 1 }).kind).toBe("humain");
    // Décision qui ne va pas avec son motif, ou hors de 0, 1, 2 : jamais « accepté ».
    expect(readDecision({ decision: 2, reason: 1, effective_decision: 2 }).kind).toBe("refuse");
    expect(readDecision({ decision: 9, reason: 0, effective_decision: 0 }).kind).toBe("refuse");
    expect(readDecision({ decision: 2, reason: 0, effective_decision: 0 }).kind).toBe("refuse");
  });

  it("un motif inconnu s'affiche « inconnu, traité comme un refus » sans planter", async () => {
    renderScenario("1", {
      tamper: (path, body) =>
        path.startsWith("/decisions")
          ? (body as Record<string, unknown>[]).map((row) => ({ ...row, reason: 42, reason_name: null, effective_decision: 0 }))
          : body,
    });
    const row = text(await screen.findByTestId("decision"));
    expect(row).toMatch(/^Refusé/);
    expect(row).toContain("motif 42 inconnu, traité comme un refus");
    expect(row).not.toContain("Accepté");
    expect(text(await screen.findByTestId("placable"))).toBe("20 u");
  });
});
