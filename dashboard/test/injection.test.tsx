// Contenus hostiles : une chaîne de type <img onerror=...> ou du texte à
// caractères bidirectionnels s'affiche comme du texte inerte, ou n'est pas
// affichée du tout si la réponse sort du schéma.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpaqueId, Untrusted } from "../src/components/atoms.tsx";
import { neutralize } from "../src/lib/safeText.ts";
import { renderScenario, text } from "./helpers.tsx";

const XSS = '<img src=x onerror="window.pwned=1">';
const BIDI = "facture‮ txt.exe​⁦cachée⁩";

const noLiveMarkup = (): void => {
  expect(document.querySelector("img, script, iframe, [onerror]")).toBeNull();
  expect((window as { pwned?: number }).pwned).toBeUndefined();
};

type Row = Record<string, unknown>;

describe("contenus non fiables", () => {
  it("un motif d'écart hostile, donné par le relais, s'affiche comme texte inerte", async () => {
    renderScenario("5", {
      tamper: (path, body) =>
        path.startsWith("/queue") ? (body as Row[]).map((row) => ({ ...row, status: "REJECTED", cause: `${XSS}${BIDI}` })) : body,
    });
    const [line] = await screen.findAllByTestId("hors-contrat");
    const shown = text(line as Element);
    expect(shown).toContain("écartée par le relais avant envoi");
    expect(shown).toContain("contenu non fiable");
    expect(shown).toContain(XSS);
    expect(shown).toContain("⟦U+202E⟧");
    expect(shown).toContain("⟦U+200B⟧");
    expect(shown).not.toMatch(/[‪-‮⁦-⁩​-‏]/);
    noLiveMarkup();
  });

  it("un agent hostile fait rejeter toute la réponse : erreur explicite, rien d'affiché", async () => {
    renderScenario("1", {
      tamper: (path, body) => (path.startsWith("/decisions") ? (body as Row[]).map((row) => ({ ...row, agent_id: XSS })) : body),
    });
    const alerts = await screen.findAllByText(/Lecture en échec : décisions : réponse non conforme au schéma/);
    for (const alert of alerts) {
      expect(text(alert)).toContain("Rien n'est affiché.");
      expect(text(alert)).not.toContain("onerror");
    }
    expect(screen.queryAllByTestId("decision")).toHaveLength(0);
    noLiveMarkup();
  });

  it("un nom de motif hostile fait rejeter la réponse", async () => {
    renderScenario("4", {
      tamper: (path, body) => (path.startsWith("/decisions") ? (body as Row[]).map((row) => ({ ...row, reason_name: `${XSS}‮` })) : body),
    });
    expect((await screen.findAllByText(/Lecture en échec : décisions : réponse non conforme au schéma/)).length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId("decision")).toHaveLength(0);
    noLiveMarkup();
  });

  it("un champ en trop, comme une justification rédigée par un agent, fait rejeter la réponse", async () => {
    renderScenario("1", {
      tamper: (path, body) => (path.startsWith("/decisions") ? (body as Row[]).map((row) => ({ ...row, justification: "urgent, payez" })) : body),
    });
    expect((await screen.findAllByText(/Lecture en échec : décisions/)).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("urgent, payez");
  });

  it("même sans validation en amont, un identifiant hors format reste du texte inerte et borné", () => {
    render(<OpaqueId value={`${XSS}‮${"A".repeat(400)}`} />);
    const shown = text(document.body);
    expect(shown).toContain("valeur hors format");
    expect(shown).toContain("<img src=x onerror=");
    expect(shown.length).toBeLessThan(80);
    noLiveMarkup();
  });

  it("un extrait est coupé à 200 caractères et ses caractères invisibles deviennent visibles", () => {
    render(<Untrusted text={`${BIDI}${XSS}${"é".repeat(400)}`} />);
    const element = document.querySelector(".non-fiable") as Element;
    expect(element.textContent).toContain("facture⟦U+202E⟧ txt.exe⟦U+200B⟧⟦U+2066⟧cachée⟦U+2069⟧");
    expect(element.textContent).toContain(XSS);
    expect(element.textContent?.endsWith("…")).toBe(true);
    noLiveMarkup();

    const safe = neutralize(`a\u0000b‮c﻿d\u{E0041}e${"x".repeat(300)}`);
    expect(safe.text.startsWith("a⟦U+0000⟧b⟦U+202E⟧c⟦U+FEFF⟧d⟦U+E0041⟧e")).toBe(true);
    expect(safe.truncated).toBe(true);
    expect(safe.neutralized).toBe(4);
    expect(Array.from(neutralize("z".repeat(500)).text)).toHaveLength(200);
  });
});
