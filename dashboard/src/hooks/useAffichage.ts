// Contexte d'affichage : unité des montants et référentiel de libellés, lus au
// proxy local (src/components/Affichage.tsx). Séparé des composants pour que
// atoms.tsx puisse le lire sans dépendance circulaire.
import { createContext, useContext } from "react";
import type { Libelle, Unite } from "../api/types.ts";
import { DEFAULT_UNITE } from "../lib/format.ts";

export type EtatLocal = "lecture" | "ok" | "indisponible";

export type Affichage = {
  unite: Unite;
  /** « ok » : déclarée par le proxy. Sinon, l'unité par défaut s'applique. */
  uniteEtat: EtatLocal;
  libelles: ReadonlyMap<string, Libelle>;
  libellesEtat: EtatLocal;
};

export const AFFICHAGE_PAR_DEFAUT: Affichage = { unite: DEFAULT_UNITE, uniteEtat: "lecture", libelles: new Map(), libellesEtat: "lecture" };

export const AffichageContext = createContext<Affichage>(AFFICHAGE_PAR_DEFAUT);

export function useAffichage(): Affichage {
  return useContext(AffichageContext);
}
