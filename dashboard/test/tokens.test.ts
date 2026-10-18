// Jetons de la direction D : les valeurs écrites dans src/styles.css sont celles
// de docs/console/tokens-direction-d.json, en clair et en sombre, et les
// contrastes annoncés y sont recalculés.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
type TokenFile = { color: { tokens: { name: string; value: { light: string; dark: string } }[] } };
const reference = JSON.parse(readFileSync(join(process.cwd(), "..", "docs", "console", "tokens-direction-d.json"), "utf8")) as TokenFile;

/** Jetons « --nom: #rrggbb » ou « --nom: rgba(…) » du bloc qui suit le sélecteur donné. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`bloc absent : ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6}|rgba\([^)]*\))\s*;/g)].map((m) => [m[1]!, m[2]!]));
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
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-2"],
  ["text", "sidebar"],
  ["text", "accent-soft"],
  ["text-2", "bg"],
  ["text-2", "surface"],
  ["text-2", "surface-2"],
  ["text-2", "sidebar"],
  ["text-3", "bg"],
  ["text-3", "surface"],
  ["text-3", "surface-2"],
  ["text-3", "sidebar"],
  ["accent", "surface"],
  ["accent", "sidebar"],
  ["accent", "accent-soft"],
  ["on-accent", "accent"],
  ["ok", "surface"],
  ["ok", "ok-soft"],
  ["warn", "surface"],
  ["warn", "warn-soft"],
  ["danger", "surface"],
  ["danger", "danger-soft"],
];

// Marques sans texte : 3:1. serie-validee n'y arrive pas (le fichier de jetons le dit) : sa légende est obligatoire.
const MARKS: [string, string][] = [
  ["accent", "surface"],
  ["serie-auto", "surface"],
  ["serie-bloquee", "surface"],
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
  it("chaque couleur est celle du fichier de jetons de la direction D", () => {
    for (const { name, value } of reference.color.tokens) {
      expect(light[name], `${name} (clair)`).toBe(value.light);
      expect(dark[name], `${name} (sombre)`).toBe(value.dark);
    }
  });

  it("le sombre du système et le sombre choisi ont les mêmes valeurs", () => {
    expect(systemDark).toEqual(dark);
  });

  it("clair et sombre définissent les mêmes couleurs", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("les polices viennent du dépôt, jamais d'ailleurs : Geist et Geist Mono, cinq graisses", () => {
    const sources = [...css.matchAll(/url\(([^)]*)\)/g)].map((m) => m[1]!.replace(/["']/g, ""));
    expect(sources).toEqual([
      "/fonts/Geist-Regular.woff2",
      "/fonts/Geist-Medium.woff2",
      "/fonts/Geist-SemiBold.woff2",
      "/fonts/GeistMono-Regular.woff2",
      "/fonts/GeistMono-Medium.woff2",
    ]);
    expect(css).not.toMatch(/@import/);
  });
});
