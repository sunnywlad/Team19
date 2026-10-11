import { useEffect, useRef, useState } from "react";

export type Arrival<T> = { item: T; count: number };

/**
 * Dernier élément apparu entre deux lectures. Chaque groupe (une source de
 * données) est amorcé à sa première lecture valide : ce qui existait déjà à
 * l'ouverture de la page n'est pas « nouveau ». Seul un changement des données
 * déclenche une arrivée ; aucun minuteur. Groupes par priorité : si deux
 * sources apportent du neuf à la même lecture, la première l'emporte.
 * « count » augmente à chaque arrivée : de quoi rejouer une animation.
 */
export function useArrival<T extends { key: string }>(groups: (T[] | null)[]): Arrival<T> | null {
  const [arrival, setArrival] = useState<Arrival<T> | null>(null);
  const seen = useRef<(Set<string> | null)[]>([]);
  const signature = groups.map((g) => (g === null ? "\u0000" : g.map((i) => i.key).join("\u0001"))).join("\u0002");

  useEffect(() => {
    let fresh: T | null = null;
    groups.forEach((group, index) => {
      if (group === null) return;
      const known = seen.current[index];
      if (known === null || known === undefined) {
        seen.current[index] = new Set(group.map((i) => i.key));
        return;
      }
      // Le plus récent des nouveaux : les groupes sont rangés du plus ancien au plus récent.
      const news = group.filter((i) => !known.has(i.key));
      for (const item of news) known.add(item.key);
      if (fresh === null && news.length > 0) fresh = news[news.length - 1] ?? null;
    });
    if (fresh !== null) {
      const item: T = fresh;
      setArrival((previous) => ({ item, count: (previous?.count ?? 0) + 1 }));
    }
    // « signature » résume « groups » : l'effet ne tourne que si les clés changent.
  }, [signature]);

  return arrival;
}
