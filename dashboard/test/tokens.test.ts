// Jetons du système de design Veto : les contrastes annoncés par
// veto-design-A/design/Fondations-visuelles.md sont recalculés ici sur les
// valeurs réellement écrites dans src/styles.css, en clair et en sombre.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

/** Jetons « --nom: #rrggbb » du bloc qui suit le sélecteur donné. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`bloc absent : ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/g)].map((m) => [m[1]!, m[2]!]));
}

const light = tokens(":root {");
const dark = tokens(':root[data-theme="dark"] {');
const systemDark = tokens(':root:not([data-theme="light"]) {');

function luminance(hex: string): number {
  const channel = (i: number): number => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// Texte : 4,5:1 (WCAG 2.1 AA).
const TEXT: [string, string][] = [
  ["texte", "fond"],
  ["texte", "surface"],
  ["texte", "surface-2"],
  ["discret", "fond"],
  ["discret", "surface"],
  ["discret", "surface-2"],
  ["accent", "surface"],
  ["accent", "accent-fond"],
  ["accepte", "surface"],
  ["humain", "surface"],
  ["refuse", "surface"],
  ["bloque", "surface"],
  ["simulation", "surface"],
  ["accepte", "accepte-fond"],
  ["humain", "humain-fond"],
  ["refuse", "refuse-fond"],
  ["bloque", "bloque-fond"],
  ["simulation", "simulation-fond"],
  ["on-accent", "accent"],
  ["entete-texte", "entete-fond"],
  ["entete-discret", "entete-fond"],
  ["entete-accent", "entete-fond"],
];

// Marques sans texte (aplats, traits, anneau de focus) : 3:1.
const MARKS: [string, string][] = [
  ["accepte-signal", "surface"],
  ["humain-signal", "surface"],
  ["refuse-signal", "surface"],
  ["trait-fort", "surface"],
  ["focus", "surface"],
  ["table", "surface"],
  ["sur-signal", "accepte-signal"],
  ["sur-signal", "humain-signal"],
  ["sur-signal", "refuse-signal"],
];

describe.each([
  ["clair", light],
  ["sombre", dark],
])("jetons, thème %s", (_name, theme) => {
  it.each(TEXT)("%s sur %s : au moins 4,5:1", (ink, ground) => {
    expect(contrast(theme[ink]!, theme[ground]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MARKS)("%s sur %s : au moins 3:1", (mark, ground) => {
    expect(contrast(theme[mark]!, theme[ground]!)).toBeGreaterThanOrEqual(3);
  });
});

describe("jetons, cohérence de la feuille", () => {
  it("le sombre du système et le sombre choisi ont les mêmes valeurs", () => {
    expect(systemDark).toEqual(dark);
  });

  it("clair et sombre définissent les mêmes couleurs", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("les polices viennent du dépôt, jamais d'ailleurs", () => {
    const sources = [...css.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]!.replace(/["']/g, ""));
    expect(sources.length).toBe(7);
    for (const source of sources) expect(source).toMatch(/^\.\/fonts\/[A-Za-z]+-\d{3}\.woff2$/);
  });
});
