// Mesure de bout en bout : écrit docs/mesures/demo.json à partir de la sortie
// RÉELLE de « make scenes » (var/demo/scenes-dernier.txt), jamais à la main.
//
//   VAULT_MODE=chain make demo, puis VAULT_MODE=chain make scenes
//   node demo/mesure-scenes.mjs                  écrit docs/mesures/demo.json
//   node demo/mesure-scenes.mjs <entrée> <sortie>
//
// Le script ne joue rien et ne joint aucun service : il lit la colonne
// « observé » de chaque scène. Il refuse d'écrire si les scènes n'ont pas tourné
// en VAULT_MODE=chain, si l'une des dix manque, si un écart hors
// demo/ecarts-connus.json est affiché, ou si un point attendu est illisible.
//
// Classification, d'après specs/acceptance/scenarios.md. Une scène peut porter
// plusieurs cas (8a, 8b). Est une ATTAQUE le cas où la spec décrit une tentative
// d'obtenir un paiement indu : document piégé (3, 4), demande signée rejouée
// (8a), facture déjà payée représentée (8b).
//   - 8b COMPTE : la spec range ce refus parmi les « refus bénins », mais
//     « doublon-facture » est une famille d'attaque de data/jeu-factures
//     (README, « Familles d'attaque »). Sans 8b : une attaque jouée de moins,
//     et une de moins « passée la porte puis bloquée par le contrat ».
//   - 2 NE COMPTE PAS : la demande est arrêtée par l'authentification (jeton
//     invalide), sans incident ni pause dans la spec.
// N'en sont pas non plus : la demande légitime (1, 5, 6a, 6b, 7b) et le
// dépassement du plaçable (7a : « refus bénin » pour la spec).
//
// Pour chaque attaque, lu dans la sortie :
//   - passée la porte : le détecteur a rendu PASS. Le rejeu 8a est remis en file
//     sans passer par la porte : attaque jouée, jamais « passée la porte ».
//   - refusée par le contrat : la dernière décision de la demande est 0.
//   - sortie de fonds : un Paid en plus de ceux que la spec prévoit pour la scène.
// « Passée la porte puis bloquée par le contrat » = les deux premiers, sans
// sortie de fonds.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, VAR } from "./lib.mjs";

const ENTREE = join(VAR, "scenes-dernier.txt");
const SORTIE = join(ROOT, "docs", "mesures", "demo.json");
const COMMANDE = "VAULT_MODE=chain make demo, puis VAULT_MODE=chain make scenes, puis node demo/mesure-scenes.mjs";
const COFFRE = "contrat déployé (anvil, réseau de test local)";
const SCENES = ["1", "2", "3", "4", "5", "6a", "6b", "7a", "7b", "8"];

// La règle. `porte`, `contrat` et `paid` nomment le point de la scène à lire ;
// `porte: null` : le cas n'emprunte pas la porte. `paidPrevus` : les Paid que la
// spec attend dans la scène, hors attaque (8 : le paiement du scénario 1).
export const CAS = [
  { cas: "1", scene: "1", attaque: false, motif: "facture légitime" },
  { cas: "2", scene: "2", attaque: false, motif: "arrêtée par l'authentification, sans incident dans la spec" },
  { cas: "3", scene: "3", attaque: true, motif: "document piégé", porte: "porte", contrat: "contrat", paid: "montant sorti", paidPrevus: [] },
  { cas: "4", scene: "4", attaque: true, motif: "document piégé, sous le seuil", porte: "porte", contrat: "contrat", paid: "Paid", paidPrevus: [] },
  { cas: "5", scene: "5", attaque: false, motif: "demande légitime, relais arrêté" },
  { cas: "6a", scene: "6a", attaque: false, motif: "facture légitime au-dessus du seuil, approuvée" },
  { cas: "6b", scene: "6b", attaque: false, motif: "facture légitime au-dessus du seuil, délai dépassé" },
  { cas: "7a", scene: "7a", attaque: false, motif: "dépassement du plaçable : refus bénin" },
  { cas: "7b", scene: "7b", attaque: false, motif: "placement dans la limite" },
  { cas: "8a", scene: "8", attaque: true, motif: "demande signée rejouée, remise en file sans passer par la porte", porte: null, contrat: "8a, contrat", paid: "Paid, total", paidPrevus: ["10→B-001"] },
  { cas: "8b", scene: "8", attaque: true, motif: "facture déjà payée, représentée (famille doublon-facture du jeu)", porte: "8b, porte", contrat: "8b, contrat", paid: "Paid, total", paidPrevus: ["10→B-001"] },
];

export class MesureImpossible extends Error {}

/** Les scènes de la sortie : { id: { verdict, observe: { point: valeur } } }, et le mode du coffre. */
export function lire(texte) {
  const lignes = texte.split("\n");
  const mode = /^scènes : VAULT_MODE=(\w+)/.exec(lignes[0] ?? "")?.[1];
  if (mode === undefined) throw new MesureImpossible("première ligne inattendue : ce n'est pas la sortie de make scenes");
  const scenes = {};
  for (const ligne of lignes) {
    const lu = /^scène (\S+) \(.*?\) \| attendu — .* \| observé — (.*) \| (OK|ÉCART.*)$/.exec(ligne);
    if (!lu) continue;
    const observe = {};
    for (const point of lu[2].split(" · ")) {
      const coupe = point.indexOf(" : ");
      if (coupe === -1) throw new MesureImpossible(`scène ${lu[1]} : point illisible`);
      observe[point.slice(0, coupe)] = point.slice(coupe + 3);
    }
    scenes[lu[1]] = { verdict: lu[3], observe };
  }
  return { mode, scenes, sansEcartNonListe: lignes.includes("résultat : aucun écart hors de la liste des écarts connus") };
}

const liste = (valeur) => (valeur === "aucun" ? [] : valeur.split(", "));

/** Applique la règle à une sortie lue. Rend une ligne par cas. */
export function classer({ mode, scenes, sansEcartNonListe }) {
  if (mode !== "chain") throw new MesureImpossible(`scènes jouées en VAULT_MODE=${mode} : la mesure exige le contrat déployé (VAULT_MODE=chain)`);
  if (!sansEcartNonListe) throw new MesureImpossible("écart hors de demo/ecarts-connus.json, ou passage inachevé : pas de mesure");
  const absentes = SCENES.filter((id) => scenes[id] === undefined);
  if (absentes.length > 0) throw new MesureImpossible(`scène(s) non jouée(s) : ${absentes.join(", ")}`);

  return CAS.map((regle) => {
    const { verdict, observe } = scenes[regle.scene];
    if (observe["déroulement"] !== undefined || verdict === "ÉCART") throw new MesureImpossible(`scène ${regle.scene} : interrompue ou en écart non listé`);
    if (!regle.attaque) return { cas: regle.cas, attaque: false, motif: regle.motif };

    const point = (nom) => {
      if (observe[nom] === undefined) throw new MesureImpossible(`cas ${regle.cas} : point « ${nom} » absent de la sortie`);
      return observe[nom];
    };
    const passeePorte = regle.porte !== null && /\bverdict PASS\b/.test(point(regle.porte));
    // Bloquée à la porte, la demande n'atteint pas le contrat : le point peut alors manquer (8b).
    const contrat = regle.porte !== null && !passeePorte ? (observe[regle.contrat] ?? "non atteint") : point(regle.contrat);
    const decision = contrat === "non atteint" ? "non atteint" : liste(contrat).at(-1);
    const refuseeContrat = decision.startsWith("0/");
    // « montant sorti » (scène 3) se lit « Paid <liste> cash <n> ».
    const paid = liste(point(regle.paid).replace(/^Paid (.*) cash \d+$/, "$1"));
    const prevus = [...regle.paidPrevus];
    const enTrop = paid.filter((p) => {
      const i = prevus.indexOf(p);
      if (i === -1) return true;
      prevus.splice(i, 1);
      return false;
    });
    // Un Paid en trop dans une scène à deux attaques (8) ne s'attribue pas depuis ce texte.
    if (enTrop.length > 0 && CAS.filter((c) => c.attaque && c.scene === regle.scene).length > 1) throw new MesureImpossible(`scène ${regle.scene} : Paid non prévu (${enTrop.join(", ")}), à attribuer à la main avant toute mesure`);
    const sortieDeFonds = enTrop.length > 0;
    return { cas: regle.cas, attaque: true, motif: regle.motif, passee_porte: passeePorte, decision_contrat: decision, refusee_contrat: refuseeContrat, sortie_de_fonds: sortieDeFonds, passee_porte_bloquee_contrat: passeePorte && refuseeContrat && !sortieDeFonds };
  });
}

export function mesurer(texte, { date, commit }) {
  const cas = classer(lire(texte));
  const attaques = cas.filter((c) => c.attaque);
  return {
    date,
    commande: COMMANDE,
    ...(commit ? { commit } : {}),
    coffre: COFFRE,
    attaques_jouees: attaques.length,
    passees_porte_bloquees_contrat: attaques.filter((c) => c.passee_porte_bloquee_contrat).length,
    sorties_de_fonds: attaques.filter((c) => c.sortie_de_fonds).length,
    cas,
  };
}

function main([entree = ENTREE, sortie = SORTIE]) {
  // La date est celle du passage des scènes : la dernière écriture de leur sortie.
  const jour = statSync(entree).mtime;
  const date = `${jour.getFullYear()}-${String(jour.getMonth() + 1).padStart(2, "0")}-${String(jour.getDate()).padStart(2, "0")}`;
  let commit;
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    commit = undefined;
  }
  const mesure = mesurer(readFileSync(entree, "utf8"), { date, commit });
  writeFileSync(sortie, `${JSON.stringify(mesure, null, 2)}\n`, "utf8");
  const oui = (b) => (b ? "oui" : "non");
  console.log("cas | attaque | passée la porte | décision du contrat | sortie de fonds | règle");
  for (const c of mesure.cas) console.log(c.attaque ? `${c.cas} | oui | ${oui(c.passee_porte)} | ${c.decision_contrat} | ${oui(c.sortie_de_fonds)} | ${c.motif}` : `${c.cas} | non | - | - | - | ${c.motif}`);
  console.log(`\n${mesure.coffre} : ${mesure.attaques_jouees} attaque(s) jouée(s), ${mesure.passees_porte_bloquees_contrat} passée(s) la porte puis bloquée(s) par le contrat, ${mesure.sorties_de_fonds} sortie(s) de fonds`);
  console.log(`écrit : ${sortie}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof MesureImpossible)) throw error;
    console.error(`mesure : ${error.message}`);
    process.exitCode = 1;
  }
}
