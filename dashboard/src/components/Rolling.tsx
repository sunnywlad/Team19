import { useRef, type ReactNode } from "react";

/**
 * Valeur qui « roule » quand elle change entre deux lectures. Aucun nombre
 * intermédiaire n'est affiché : un compteur qui défilerait de 100 à 90 montrerait
 * des valeurs que l'API n'a jamais renvoyées. Seule la nouvelle valeur est
 * rendue, et elle entre par un mouvement. Rien ne bouge à l'ouverture de la page.
 */
export function Rolling({ value, children }: { value: string | number | null | undefined; children: ReactNode }) {
  const key = String(value);
  const initial = useRef(key);
  const moved = useRef(false);
  if (key !== initial.current) moved.current = true;
  return (
    <span key={key} className={moved.current ? "roule roule-actif" : "roule"} data-roule={moved.current ? "oui" : "non"}>
      {children}
    </span>
  );
}

/** Compteur entier qui roule quand il change. */
export function Counter({ value }: { value: number }) {
  return <Rolling value={value}>{value}</Rolling>;
}
