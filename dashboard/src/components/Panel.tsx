import type { ReactNode } from "react";
import type { Source } from "../api/types.ts";
import type { Snapshot } from "../hooks/poller.ts";
import { isStale } from "../hooks/poller.ts";
import { formatTime } from "../lib/format.ts";
import { SourceTag } from "./atoms.tsx";

type Props<T> = {
  title: string;
  /** Identifiant du titre, pour aria-labelledby. */
  id: string;
  source: Source;
  snapshot: Snapshot<T>;
  now: number;
  /** Appelé seulement avec une lecture valide. */
  children: (data: T) => ReactNode;
  className?: string;
};

/**
 * Un panneau et ses quatre états : chargement, erreur, données à jour, données
 * périmées. Périmé : les valeurs restent lisibles mais grisées et étiquetées,
 * jamais présentées comme à jour.
 */
export function Panel<T>({ title, id, source, snapshot, now, children, className }: Props<T>) {
  const stale = isStale(snapshot, now);
  const { data, error, lastOkAt } = snapshot;
  return (
    <section className={`panneau ${className ?? ""}`} aria-labelledby={id} aria-busy={data === null && error === null}>
      <header className="panneau-entete">
        <h2 id={id}>{title}</h2>
        <SourceTag source={source} />
      </header>
      {error !== null && (
        <p className="erreur" role="alert">
          Lecture en échec : {error}. {data === null ? "Rien n'est affiché." : "La dernière lecture valide reste affichée."}
        </p>
      )}
      {data === null && error === null && (
        <p className="chargement" role="status">
          Chargement…
        </p>
      )}
      {data !== null && (
        <div className={stale ? "valeurs perime" : "valeurs"} data-perime={stale ? "true" : "false"}>
          {stale && (
            <p className="perime-note">
              Valeurs périmées : dernière lecture réussie à {lastOkAt === null ? "—" : formatTime(lastOkAt)}.
            </p>
          )}
          {children(data)}
        </div>
      )}
    </section>
  );
}
