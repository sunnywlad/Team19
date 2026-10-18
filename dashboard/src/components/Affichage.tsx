// Ce qui ne sert qu'à l'affichage et vient du proxy local, pas des services :
// l'unité des montants et le référentiel de libellés. Lus une fois à
// l'ouverture, validés par schéma. Sans réponse : « u », 15 décimales, et les
// identifiants abrégés. Un libellé ne remplace jamais l'identifiant dans les
// données : il s'affiche à côté.
import { useEffect, useState, type ReactNode } from "react";
import type { ApiClient } from "../api/client.ts";
import type { Libelle, LibelleGenre } from "../api/types.ts";
import { AFFICHAGE_PAR_DEFAUT, AffichageContext, useAffichage, type Affichage } from "../hooks/useAffichage.ts";
import { DEFAULT_UNITE, abbreviateId } from "../lib/format.ts";
import { OpaqueId } from "./atoms.tsx";

/** Référentiel indexé par identifiant. Un identifiant présent deux fois : la première ligne fait foi. */
export function indexLibelles(rows: Libelle[]): Map<string, Libelle> {
  const map = new Map<string, Libelle>();
  for (const row of rows) if (!map.has(row.id)) map.set(row.id, row);
  return map;
}

/** Libellé d'un identifiant, s'il est au référentiel et du genre attendu. null : afficher l'identifiant abrégé. */
export function libelleOf(libelles: ReadonlyMap<string, Libelle>, id: string | null | undefined, genre?: LibelleGenre): Libelle | null {
  if (id === null || id === undefined) return null;
  const found = libelles.get(id);
  if (!found || (genre !== undefined && found.genre !== genre)) return null;
  return found;
}

/** Texte court d'un identifiant : son libellé, ou sa forme abrégée. Pour les attributs (titres, aria-label). */
export function nomTexte(libelles: ReadonlyMap<string, Libelle>, id: string | null | undefined, genre?: LibelleGenre): string {
  const found = libelleOf(libelles, id, genre);
  if (found) return found.libelle;
  if (id === null || id === undefined) return "non disponible";
  return abbreviateId(id) ?? "valeur hors format";
}

/** Lit l'unité et les libellés une fois. Une erreur n'empêche rien : l'affichage retombe sur ses défauts. */
export function AffichageProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  const [state, setState] = useState<Affichage>(AFFICHAGE_PAR_DEFAUT);
  useEffect(() => {
    const controller = new AbortController();
    client.getUnite(controller.signal).then(
      (unite) => setState((s) => ({ ...s, unite, uniteEtat: "ok" })),
      () => !controller.signal.aborted && setState((s) => ({ ...s, unite: DEFAULT_UNITE, uniteEtat: "indisponible" })),
    );
    client.getLibelles(controller.signal).then(
      (file) => setState((s) => ({ ...s, libelles: indexLibelles(file.libelles), libellesEtat: "ok" })),
      () => !controller.signal.aborted && setState((s) => ({ ...s, libellesEtat: "indisponible" })),
    );
    return () => controller.abort();
  }, [client]);
  return <AffichageContext.Provider value={state}>{children}</AffichageContext.Provider>;
}

/**
 * Nom d'un identifiant opaque : le libellé du référentiel, ou l'identifiant
 * abrégé s'il n'y figure pas. `withId` ajoute l'identifiant abrégé à côté du
 * libellé, pour qu'on puisse toujours le retrouver dans le journal.
 */
export function Nom({
  id,
  genre,
  missing = "—",
  withId = false,
}: {
  id: string | null | undefined;
  genre?: LibelleGenre;
  missing?: string;
  withId?: boolean;
}) {
  const { libelles } = useAffichage();
  const found = libelleOf(libelles, id, genre);
  if (!found) return <OpaqueId value={id} missing={missing} />;
  return (
    <span className="nom" data-libelle="oui">
      <span className="nom-libelle">{found.libelle}</span>
      {withId && (
        <>
          {" "}
          <OpaqueId value={id} />
        </>
      )}
    </span>
  );
}
