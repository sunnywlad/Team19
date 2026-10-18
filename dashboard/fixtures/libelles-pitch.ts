// Référentiel de libellés du scénario « pitch », tiré du catalogue de
// fixtures/pitch.ts. Le fichier fixtures/libelles-pitch.json en est la copie
// écrite ; test/pitch.test.ts vérifie qu'ils sont identiques.
//   Réécrire le fichier : node fixtures/libelles-pitch.ts --ecrire
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Libelle, Libelles } from "../src/api/types.ts";
import { AGENTS, CLIENT, FOURNISSEURS, agentId, beneficiaryId, reserves } from "./pitch.ts";
import { fixture } from "./sim.ts";

export const LIBELLES_PITCH_FILE = join(dirname(fileURLToPath(import.meta.url)), "libelles-pitch.json");

export function pitchLibelles(): Libelles {
  const { parAgent, validation, incidents } = reserves();
  const pieces = [...Object.values(parAgent).flat(), ...validation, ...incidents];
  const rows: Libelle[] = [
    { id: fixture("C-DEMO"), genre: "client", libelle: CLIENT.libelle, detail: CLIENT.detail },
    ...AGENTS.map((a): Libelle => ({ id: agentId(a.key), genre: "agent", libelle: a.libelle, sous_titre: a.sous_titre })),
    ...FOURNISSEURS.map(
      (f): Libelle => ({
        id: beneficiaryId(f.key),
        genre: "beneficiaire",
        libelle: f.libelle,
        sous_titre: f.sous_titre,
        iban_masque: f.iban_masque,
        ...(f.siren ? { siren: f.siren } : {}),
      }),
    ),
    ...pieces.map(
      (p): Libelle =>
        p.placement
          ? { id: p.id, genre: "placement", libelle: `Placement ${p.numero}` }
          : { id: p.id, genre: "facture", libelle: `Facture ${p.numero}` },
    ),
  ];
  return { version: 1, libelles: rows };
}

export const libellesPitchText = (): string => `${JSON.stringify(pitchLibelles(), null, 1)}\n`;

if (process.argv.includes("--ecrire")) {
  writeFileSync(LIBELLES_PITCH_FILE, libellesPitchText());
  console.error(`[pitch] ${pitchLibelles().libelles.length} libellés écrits dans ${LIBELLES_PITCH_FILE}`);
}
