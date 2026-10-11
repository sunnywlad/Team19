// Écarts connus entre ce que les services font et ce que la spec attend.
//
// demo/ecarts-connus.json les liste : ils sont corrigés ailleurs (gateway/,
// response/). Une scène qui ne s'écarte de la spec que par eux s'affiche
// « ÉCART CONNU (E1) » et ne fait pas échouer make scenes. Deux garde-fous :
//   - un écart qui n'est pas dans la liste, ou qui se produit dans une scène
//     que la liste ne nomme pas, reste un « ÉCART » et fait échouer ;
//   - un écart de la liste qui ne se produit plus fait échouer aussi, pour que
//     la liste ne pourrisse pas.
//
// Rien n'est reconnu sur parole : chaque identifiant a ici une règle qui dit
// exactement quelle différence il couvre. La règle s'applique aux deux suites
// d'entrées de journal, l'attendue et l'observée ; si elles deviennent égales,
// l'écart est celui-là et rien d'autre.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const KNOWN_FILE = join(dirname(fileURLToPath(import.meta.url)), "ecarts-connus.json");
const FIELDS = ["id", "scenes", "description", "attendu", "observe", "responsable", "retrait"];
const AVAILABILITY = "ALERT_SENT(AVAILABILITY)";

const RULES = {
  // FORWARDED_TO_CLIENT_AI écrit après REQUEST_SIGNED : remis à sa place attendue.
  E1: ({ expected, observed }) => {
    const forwarded = observed.indexOf("FORWARDED_TO_CLIENT_AI");
    const signed = observed.indexOf("REQUEST_SIGNED");
    if (signed === -1 || forwarded < signed) return { expected, observed };
    const moved = observed.filter((_, i) => i !== forwarded);
    moved.splice(signed, 0, "FORWARDED_TO_CLIENT_AI");
    return { expected, observed: moved };
  },
  // Alerte de disponibilité : ni sa présence ni sa place ne sont comparées.
  E2: ({ expected, observed }) => ({ expected: expected.filter((l) => l !== AVAILABILITY), observed: observed.filter((l) => l !== AVAILABILITY) }),
};

export function loadKnown(path = KNOWN_FILE) {
  const list = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(list)) throw new Error("ecarts-connus.json : une liste est attendue");
  for (const item of list) {
    const keys = Object.keys(item);
    if (keys.length !== FIELDS.length || FIELDS.some((f) => !(f in item))) throw new Error(`ecarts-connus.json : champs attendus ${FIELDS.join(", ")}`);
    if (!Array.isArray(item.scenes) || item.scenes.length === 0) throw new Error(`ecarts-connus.json : ${item.id} ne nomme aucune scène`);
    if (RULES[item.id] === undefined) throw new Error(`ecarts-connus.json : ${item.id} n'a pas de règle dans demo/ecarts.mjs`);
  }
  if (new Set(list.map((item) => item.id)).size !== list.length) throw new Error("ecarts-connus.json : identifiant en double");
  return list;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function subsets(items) {
  const all = [[]];
  for (const item of items) for (const subset of [...all]) all.push([...subset, item]);
  return all.slice(1).sort((a, b) => a.length - b.length);
}

/**
 * Identifiants des écarts connus qui expliquent à eux seuls un point en écart,
 * au plus petit nombre. null : rien dans la liste ne l'explique.
 * Un point sans suites brutes (`raw`) n'est jamais couvert.
 */
export function explain(sceneId, check, known) {
  if (check.ok) return [];
  if (!check.raw) return null;
  const candidates = known.filter((k) => k.scenes.includes(sceneId)).map((k) => k.id);
  for (const ids of subsets(candidates)) {
    const { expected, observed } = ids.reduce((lists, id) => RULES[id](lists), { expected: check.raw.expected, observed: check.raw.observed });
    if (same(check.raw.tail ? observed.slice(-expected.length) : observed, expected)) return ids;
  }
  return null;
}

/**
 * Classe les points de chaque scène jouée. Rend :
 *   scenes    par scène : son verdict et, par point en écart, les identifiants qui le couvrent (null : inconnu)
 *   unknown   écarts hors liste : font échouer
 *   vanished  écarts listés pour une scène jouée jusqu'au bout et qui ne s'y produisent plus : font échouer.
 *             `everywhere` : disparu de toutes ses scènes jouées
 *   active    écarts connus observés
 *   code      0 si ni inconnu ni disparu
 */
export function evaluate(played, known) {
  const scenes = [];
  const unknown = [];
  const gone = [];
  const stillThere = [];
  const seen = new Set();
  for (const scene of played) {
    const gaps = scene.checks.filter((c) => !c.ok).map((check) => ({ check, ids: explain(scene.id, check, known) }));
    const here = new Set(gaps.flatMap((g) => g.ids ?? []));
    for (const id of here) seen.add(id);
    for (const g of gaps) if (g.ids === null) unknown.push({ scene: scene.id, check: g.check });
    // Une scène interrompue ne dit rien de ce qui aurait suivi.
    const complete = !scene.checks.some((c) => c.point === "déroulement" && !c.ok);
    if (complete) for (const k of known) if (k.scenes.includes(scene.id)) (here.has(k.id) ? stillThere : gone).push({ id: k.id, scene: scene.id });
    const verdict = gaps.length === 0 ? "OK" : gaps.some((g) => g.ids === null) ? "ÉCART" : `ÉCART CONNU (${[...here].sort().join(", ")})`;
    scenes.push({ id: scene.id, verdict, gaps });
  }
  const active = known.filter((k) => seen.has(k.id));
  const vanished = known
    .map((k) => ({ id: k.id, scenes: gone.filter((g) => g.id === k.id).map((g) => g.scene), everywhere: !stillThere.some((g) => g.id === k.id) }))
    .filter((v) => v.scenes.length > 0);
  return { scenes, unknown, vanished, active, code: unknown.length === 0 && vanished.length === 0 ? 0 : 1 };
}

export function vanishedMessage(entry) {
  if (entry.everywhere) return `écart ${entry.id} disparu : retire-le de demo/ecarts-connus.json`;
  return `écart ${entry.id} disparu en scène ${entry.scenes.join(", ")} : retire ${entry.scenes.length > 1 ? "ces scènes" : "cette scène"} de sa liste dans demo/ecarts-connus.json`;
}
