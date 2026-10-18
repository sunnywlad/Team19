// Proxy local : libellés et unité d'affichage (API-NEEDS.md § 7 et § 8). Ils ne
// servent qu'à l'affichage ; leur absence ne casse rien et ne fait jamais lire
// « € » ni 0.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Libelle } from "../src/api/types.ts";
import { Nom, indexLibelles, libelleOf, nomTexte } from "../src/components/Affichage.tsx";
import { Amount } from "../src/components/atoms.tsx";
import { AFFICHAGE_PAR_DEFAUT, AffichageContext } from "../src/hooks/useAffichage.ts";
import { formatAmount, formatWei, unitLegend } from "../src/lib/format.ts";
import { parse } from "../src/validation/validate.ts";
import {
  DEFAULT_LIBELLES_FILE,
  LOCAL_LIBELLES_PATH,
  LOCAL_UNITE_PATH,
  libellesFile,
  localLibelles,
  localUnite,
  uniteFrom,
} from "../vite.config.ts";
import { FIXTURE_LIBELLES, renderScenario, text } from "./helpers.tsx";

type Reply = { status: number; body: unknown; passed: boolean };

/** Appelle un middleware du proxy comme le ferait le serveur de Vite. */
function call(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void, url: string): Reply {
  const reply: Reply = { status: 0, body: undefined, passed: false };
  const res = {
    writeHead: (status: number) => void (reply.status = status),
    end: (body: string) => void (reply.body = JSON.parse(body)),
  } as unknown as ServerResponse;
  handler({ url, method: "GET" } as IncomingMessage, res, () => void (reply.passed = true));
  return reply;
}

const IDS = (JSON.parse(readFileSync(join(process.cwd(), "..", "specs", "examples", "fixtures.json"), "utf8")) as { ids: Record<string, string> }).ids;
const F001 = IDS["F-001"]!;
const B001 = IDS["B-001"]!;
const F999 = IDS["F-999"]!;

describe("proxy local : unité d'affichage", () => {
  it("sans déclaration : « u » et 15 décimales, jamais « € » par défaut", () => {
    expect(uniteFrom(undefined, undefined)).toEqual({ symbole: "u", decimales: 15 });
    expect(uniteFrom("  ", "")).toEqual({ symbole: "u", decimales: 15 });
  });

  it("déclarée : reprise telle quelle ; mal formée : défaut", () => {
    expect(uniteFrom("€", "18")).toEqual({ symbole: "€", decimales: 18 });
    expect(uniteFrom("<b>", "-1")).toEqual({ symbole: "u", decimales: 15 });
    expect(uniteFrom("EUR€EUR", "99")).toEqual({ symbole: "u", decimales: 15 });
  });

  it("GET /api/local/unite sert l'unité, conforme à son schéma ; les autres chemins passent", () => {
    const handler = localUnite({ symbole: "u", decimales: 18 });
    const reply = call(handler, LOCAL_UNITE_PATH);
    expect(reply.status).toBe(200);
    expect(parse.unite(reply.body)).toEqual({ symbole: "u", decimales: 18 });
    expect(call(handler, "/api/relay/status").passed).toBe(true);
  });

  it("le schéma refuse un symbole hostile ou un champ en trop", () => {
    expect(() => parse.unite({ symbole: "<img>", decimales: 15 })).toThrow(/non conforme/);
    expect(() => parse.unite({ symbole: "u", decimales: 15, taux: 1 })).toThrow(/non conforme/);
    expect(() => parse.unite({ symbole: "u", decimales: 31 })).toThrow(/non conforme/);
  });
});

describe("proxy local : référentiel de libellés", () => {
  it("par défaut : fixtures/libelles.json, relatif au dossier du dashboard", () => {
    expect(libellesFile(undefined)).toBe(join(process.cwd(), DEFAULT_LIBELLES_FILE));
    expect(libellesFile("/tmp/x.json")).toBe("/tmp/x.json");
  });

  it("le fichier de démo passe le schéma et ne nomme que des identifiants des fixtures", () => {
    const file = parse.libelles(FIXTURE_LIBELLES);
    const known = new Set(Object.values(IDS));
    expect(file.libelles.length).toBeGreaterThan(0);
    for (const row of file.libelles) expect(known.has(row.id), row.libelle).toBe(true);
    // F-999 n'est pas inscrite : elle reste sans libellé, pour montrer le repli.
    expect(file.libelles.some((row) => row.id === F999)).toBe(false);
  });

  it("fichier de démo par défaut : ni IBAN, ni SIREN (API-NEEDS.md § 7)", () => {
    for (const row of parse.libelles(FIXTURE_LIBELLES).libelles) {
      expect(row.iban_masque, row.libelle).toBeUndefined();
      expect(row.siren, row.libelle).toBeUndefined();
    }
  });

  it("GET /api/local/libelles relit le fichier ; absent ou illisible : 503, sans le chemin", () => {
    const dir = mkdtempSync(join(tmpdir(), "libelles-"));
    const path = join(dir, "libelles.json");
    writeFileSync(path, JSON.stringify({ version: 1, libelles: [{ id: F001, genre: "facture", libelle: "Facture test" }] }));
    expect(call(localLibelles(path), LOCAL_LIBELLES_PATH)).toMatchObject({ status: 200 });
    writeFileSync(path, "{ pas du json");
    const broken = call(localLibelles(path), LOCAL_LIBELLES_PATH);
    expect(broken.status).toBe(503);
    expect(JSON.stringify(broken.body)).not.toContain(dir);
    expect(call(localLibelles(join(dir, "absent.json")), LOCAL_LIBELLES_PATH).status).toBe(503);
  });

  it("sous-titre, IBAN masqué et SIREN : facultatifs ; un IBAN en clair ou un SIREN mal formé est refusé", () => {
    const row = (extra: Record<string, string>) => ({ version: 1, libelles: [{ id: B001, genre: "beneficiaire", libelle: "Fournisseur test", ...extra }] });
    expect(parse.libelles(row({})).libelles[0]).toEqual({ id: B001, genre: "beneficiaire", libelle: "Fournisseur test" });
    const full = row({ sous_titre: "Facture FB-2026-1183", iban_masque: "FR76 3000 4012 •••• •••• 4021", siren: "812 447 906" });
    expect(parse.libelles(full).libelles[0]?.iban_masque).toBe("FR76 3000 4012 •••• •••• 4021");
    expect(parse.libelles(row({ iban_masque: "FR76 •••• 4021" })).libelles[0]?.iban_masque).toBe("FR76 •••• 4021");
    const bads: Record<string, string>[] = [
      { iban_masque: "FR76 3000 4012 3456 7890 1234 021" },
      { iban_masque: "FR7630004012345678901234021" },
      { iban_masque: "FR76 •••• 4021<b>" },
      { siren: "812447905" },
      { siren: "812 447 90" },
      { sous_titre: "<script>" },
    ];
    for (const bad of bads) {
      expect(() => parse.libelles(row(bad)), JSON.stringify(bad)).toThrow(/non conforme/);
    }
  });

  it("le schéma refuse un libellé hostile : balise, caractère bidirectionnel ou invisible, texte trop long", () => {
    const row = (libelle: string) => ({ version: 1, libelles: [{ id: F001, genre: "facture", libelle }] });
    for (const bad of ['<img src=x onerror="1">', "Facture‮ fde", "Facture​x", "A".repeat(61), " espace devant"]) {
      expect(() => parse.libelles(row(bad))).toThrow(/non conforme/);
    }
    expect(() => parse.libelles({ version: 1, libelles: [{ id: F001, genre: "facture", libelle: "Facture", iban: "FR76" }] })).toThrow(/non conforme/);
  });
});

describe("repli des libellés", () => {
  const rows: Libelle[] = [
    { id: F001, genre: "facture", libelle: "Facture F-001" },
    { id: B001, genre: "beneficiaire", libelle: "Fournisseur fictif A" },
    { id: F001, genre: "facture", libelle: "Doublon ignoré" },
  ];
  const map = indexLibelles(rows);

  it("libellé présent : affiché ; absent, d'un autre genre ou identifiant nul : identifiant abrégé", () => {
    expect(libelleOf(map, F001)?.libelle).toBe("Facture F-001");
    expect(libelleOf(map, B001, "agent")).toBeNull();
    expect(nomTexte(map, F999)).toBe("0xe569…919d");
    expect(nomTexte(map, null)).toBe("non disponible");
    expect(nomTexte(map, "Jean Dupont")).toBe("valeur hors format");
  });

  it("composant : libellé, ou identifiant abrégé ; l'identifiant reste à côté sur demande", () => {
    render(
      <AffichageContext.Provider value={{ ...AFFICHAGE_PAR_DEFAUT, libelles: map }}>
        <p data-testid="a">
          <Nom id={F001} withId />
        </p>
        <p data-testid="b">
          <Nom id={F999} />
        </p>
      </AffichageContext.Provider>,
    );
    expect(text(screen.getByTestId("a"))).toBe("Facture F-001 0x0665…b49c");
    expect(text(screen.getByTestId("b"))).toBe("0xe569…919d");
  });

  it("référentiel hostile : réponse rejetée, la console affiche les identifiants abrégés", async () => {
    const hostile = { version: 1, libelles: [{ id: B001, genre: "beneficiaire", libelle: '<img src=x onerror="window.pwned=1">' }] };
    renderScenario("1", { local: { libelles: hostile } });
    await screen.findAllByTestId("decision");
    expect(document.body.textContent).not.toContain("onerror");
    expect(document.querySelector("img, [onerror]")).toBeNull();
  });
});

describe("formatage de l'unité", () => {
  it("le même montant en wei, selon les décimales déclarées", () => {
    expect(formatWei("30000000000000000", 15)).toBe("30");
    expect(formatWei("30000000000000000", 18)).toBe("0,03");
    expect(formatWei("1500000000000000000", 18)).toBe("1,5");
    expect(formatWei("42", 0)).toBe("42");
    expect(formatWei(null, 18)).toBeNull();
    expect(unitLegend({ symbole: "u", decimales: 15 })).toBe("1 u = 10¹⁵ wei");
    expect(unitLegend({ symbole: "€", decimales: 18 })).toBe("1 € = 10¹⁸ wei");
  });

  it("en euros : format monétaire français, deux décimales au moins, sans arrondi", () => {
    const euro = { symbole: "€", decimales: 2 };
    expect(formatAmount("4860000", euro)).toBe("48\u202f600,00");
    expect(formatAmount("4860050", euro)).toBe("48\u202f600,50");
    expect(formatAmount("125", { symbole: "€", decimales: 0 })).toBe("125,00");
    // Plus fin que le centime : affiché tel quel, jamais arrondi.
    expect(formatAmount("1234", { symbole: "€", decimales: 3 })).toBe("1,234");
    expect(formatAmount(null, euro)).toBeNull();
    // Toute autre unité garde le format de formatWei.
    expect(formatAmount("30000000000000000", { symbole: "u", decimales: 15 })).toBe("30");
  });

  it("montant absent : « non disponible », dans toute unité", () => {
    render(
      <AffichageContext.Provider value={{ ...AFFICHAGE_PAR_DEFAUT, unite: { symbole: "€", decimales: 18 }, uniteEtat: "ok" }}>
        <p data-testid="m">
          <Amount wei={null} />
        </p>
        <p data-testid="n">
          <Amount wei="2500000000000000000" />
        </p>
      </AffichageContext.Provider>,
    );
    expect(text(screen.getByTestId("m"))).toBe("non disponible");
    expect(text(screen.getByTestId("n"))).toBe("2,50 €");
  });

  it("unité déclarée par le proxy : appliquée partout ; proxy muet : « u », et le pied le dit", async () => {
    const declared = renderScenario("1", { local: { unite: { symbole: "€", decimales: 15 } } });
    expect(text(await screen.findByTestId("placable"))).toBe("20,00 €");
    declared.unmount();

    renderScenario("1", { local: { unite: { symbole: 12 } } });
    expect(text(await screen.findByTestId("placable"))).toBe("20 u");
    expect(await screen.findByText(/unité non déclarée par le proxy local/)).toBeTruthy();
  });
});
