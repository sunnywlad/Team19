// Ouvre le panneau « Sources » de la barre haute depuis l'icône de provenance
// d'un panneau. Séparé des composants pour éviter une dépendance circulaire.
import { createContext } from "react";

export type Provenance = { ouvrirSources: () => void };

export const ProvenanceContext = createContext<Provenance>({ ouvrirSources: () => undefined });
