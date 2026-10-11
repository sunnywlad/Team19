#!/usr/bin/env node
// Remplit le tableau de métriques, la section « cas manqués » et la limite du
// jeu à un pour un de docs/fiche-defense.md à partir des fichiers de docs/mesures/.
//
//   node docs/outils/remplir-fiche.mjs           réécrit la fiche
//   node docs/outils/remplir-fiche.mjs --check   échoue si la fiche diffère
//
// Aucun chiffre ne s'écrit à la main : une case sans fichier de mesure reste
// « à mesurer ». Formats attendus : docs/mesures/README.md.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FICHE = join(RACINE, "docs", "fiche-defense.md");
const MESURES = join(RACINE, "docs", "mesures");
const MANIFESTE = join(RACINE, "data", "jeu-factures", "MANIFEST.json");

export const A_MESURER = "à mesurer";
export const MARQUEURS = {
  metriques: ["<!-- metriques:debut -->", "<!-- metriques:fin -->"],
  casManques: ["<!-- cas-manques:debut -->", "<!-- cas-manques:fin -->"],
  limiteJeu: ["<!-- limite-jeu:debut -->", "<!-- limite-jeu:fin -->"],
};

class MesureInvalide extends Error {}

function lireJson(chemin) {
  if (!existsSync(chemin)) return null;
  try {
    return JSON.parse(readFileSync(chemin, "utf8"));
  } catch {
    throw new MesureInvalide(`${chemin} : JSON illisible`);
  }
}

const entier = (n) => Number.isInteger(n) && n >= 0;
const taux = (n) => n === null || (typeof n === "number" && n >= 0 && n <= 1);

// Une mesure sans date ni commande ne se publie pas.
function exigerOrigine(objet, nom) {
  if (objet === null || typeof objet !== "object") throw new MesureInvalide(`${nom} : objet attendu`);
  if (typeof objet.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(objet.date)) throw new MesureInvalide(`${nom} : « date » attendue, AAAA-MM-JJ`);
  if (typeof objet.commande !== "string" || objet.commande.trim() === "" || /[|\n`]/.test(objet.commande)) {
    throw new MesureInvalide(`${nom} : « commande » attendue, sur une ligne, sans barre verticale ni accent grave`);
  }
}

function exigerBanc(rapport, nom) {
  const t = rapport?.test;
  const ok =
    typeof rapport?.detector_version === "string" &&
    /^[\w.-]{1,40}$/.test(rapport.detector_version) &&
    t !== undefined &&
    [t.threshold, t.attacks, t.legit, t.true_positives, t.false_positives, t.false_negatives].every(entier) &&
    [t.recall, t.precision, t.false_positive_rate].every(taux) &&
    Array.isArray(t.missed_attack_ids) &&
    Array.isArray(t.false_positive_ids) &&
    typeof t.recall_by_family === "object" &&
    typeof t.detection_ms?.mean === "number" &&
    typeof t.detection_ms?.max === "number";
  if (!ok) throw new MesureInvalide(`${nom} : ce n'est pas la sortie de « npm run bench -- <jeu> --json »`);
  if (t.true_positives + t.false_negatives !== t.attacks || t.missed_attack_ids.length !== t.false_negatives || t.false_positive_ids.length !== t.false_positives) {
    throw new MesureInvalide(`${nom} : compteurs incohérents`);
  }
}

function exigerDelai(d, nom) {
  if (d === undefined || d === null) return;
  if (!entier(d.n) || d.n === 0 || !entier(d.mediane_ms) || !entier(d.max_ms)) throw new MesureInvalide(`${nom} : { n, mediane_ms, max_ms } entiers attendus`);
}

export function charger(dossier = MESURES, manifeste = MANIFESTE) {
  const m = lireJson(manifeste);
  if (m === null) throw new MesureInvalide(`${manifeste} : manifeste du jeu introuvable`);
  const jeu = { test: m.fichiers["test.jsonl"], reglage: m.fichiers["dev.jsonl"] };

  const banc = lireJson(join(dossier, "bench-test.json"));
  const origineBanc = lireJson(join(dossier, "bench-test.meta.json"));
  if (banc !== null) {
    exigerBanc(banc, "bench-test.json");
    if (origineBanc === null) throw new MesureInvalide("bench-test.json sans bench-test.meta.json : date et commande manquent");
    exigerOrigine(origineBanc, "bench-test.meta.json");
    if (origineBanc.jeu_sha256 !== jeu.test.sha256) throw new MesureInvalide("bench-test.meta.json : « jeu_sha256 » n'est pas celui de test.jsonl dans le MANIFEST");
    // Garde-fou contre un autre jeu : les identifiants de test.jsonl sont t-001 à t-200.
    const ids = [...banc.test.missed_attack_ids, ...banc.test.false_positive_ids];
    if (!ids.every((id) => typeof id === "string" && /^t-\d{3}$/.test(id))) throw new MesureInvalide("bench-test.json : identifiants hors du jeu de test");
    if (banc.test.attacks > jeu.test.etiquettes.attack || banc.test.legit > jeu.test.etiquettes.legit) throw new MesureInvalide("bench-test.json : plus d'échantillons que le jeu de test");
  } else if (origineBanc !== null) {
    throw new MesureInvalide("bench-test.meta.json sans bench-test.json");
  }

  const reference = lireJson(join(dossier, "bench-reference.json"));
  const origineReference = lireJson(join(dossier, "bench-reference.meta.json"));
  if (reference !== null) {
    exigerBanc(reference, "bench-reference.json");
    if (origineReference === null) throw new MesureInvalide("bench-reference.json sans bench-reference.meta.json");
    exigerOrigine(origineReference, "bench-reference.meta.json");
  }

  const delais = lireJson(join(dossier, "delais.json"));
  if (delais !== null) {
    exigerOrigine(delais, "delais.json");
    for (const source of ["porte", "contrat"]) {
      for (const champ of ["arrivee_detection", "detection_pause", "detection_alerte"]) exigerDelai(delais[source]?.[champ], `delais.json, ${source}.${champ}`);
    }
  }

  const demo = lireJson(join(dossier, "demo.json"));
  if (demo !== null) {
    exigerOrigine(demo, "demo.json");
    if (![demo.attaques_jouees, demo.passees_porte_bloquees_contrat, demo.sorties_de_fonds].every(entier)) throw new MesureInvalide("demo.json : compteurs entiers attendus");
    if (typeof demo.coffre !== "string" || !/^[\p{L}\d .'()-]{3,60}$/u.test(demo.coffre)) throw new MesureInvalide("demo.json : « coffre » attendu (faux coffre, doublure ou contrat déployé)");
  }

  return { jeu, banc, origineBanc, reference, origineReference, delais, demo };
}

const pourcent = (n) => (n === null ? "indéfini" : `${(n * 100).toFixed(1).replace(".", ",")} %`);
const decimal = (n) => String(n).replace(".", ",");
const origine = (o) => `mesuré le ${o.date}, commande \`${o.commande}\`${typeof o.commit === "string" && /^[0-9a-f]{7,40}$/.test(o.commit) ? `, commit ${o.commit.slice(0, 7)}` : ""}`;
const delai = (d) => (d ? `médiane ${d.mediane_ms} ms, maximum ${d.max_ms} ms, sur ${d.n}` : A_MESURER);

export function rendreMetriques({ jeu, banc, origineBanc, reference, origineReference, delais, demo }) {
  const t = banc?.test;
  const r = reference?.test;
  const lignes = [
    "| Métrique | Valeur | Conditions |",
    "|---|---|---|",
    `| Taille du jeu de test | ${jeu.test.etiquettes.legit} légitimes / ${jeu.test.etiquettes.attack} attaques | Lu dans le MANIFEST du jeu ; jeu de réglage : ${jeu.reglage.etiquettes.legit} / ${jeu.reglage.etiquettes.attack} |`,
    `| Échantillons mesurés par le banc | ${t ? `${t.legit} légitimes / ${t.attacks} attaques` : A_MESURER} | ${t ? `Détecteur \`${banc.detector_version}\`, seuil ${t.threshold}` : "Le banc écarte de lui-même un tiers du fichier qu'il reçoit"} |`,
    `| Taux de détection (rappel) | ${t ? `${t.true_positives} sur ${t.attacks} (${pourcent(t.recall)})` : A_MESURER} | Sur le jeu de test |`,
    `| Faux positifs | ${t ? `${t.false_positives} sur ${t.legit} (${pourcent(t.false_positive_rate)})` : A_MESURER} | Nombre et taux, sur le jeu de test |`,
    `| Mêmes mesures pour les règles fixes | ${r ? `rappel ${pourcent(r.recall)}, faux positifs ${r.false_positives} sur ${r.legit}` : A_MESURER} | Référence de comparaison |`,
    `| Temps de calcul du détecteur | ${t ? `moyenne ${decimal(t.detection_ms.mean)} ms, maximum ${decimal(t.detection_ms.max)} ms` : A_MESURER} | Règles seules, hors porte d'entrée |`,
    `| Attaques passées la porte d'entrée puis bloquées par le contrat | ${demo ? `${demo.passees_porte_bloquees_contrat} sur ${demo.attaques_jouees} jouées` : A_MESURER} | ${demo ? `Coffre utilisé : ${demo.coffre}` : "Demande un contrat déployé"} |`,
    `| Attaques ayant abouti à une sortie de fonds | ${demo ? `${demo.sorties_de_fonds} sur ${demo.attaques_jouees} jouées` : A_MESURER} | ${demo ? `Coffre utilisé : ${demo.coffre}` : "Demande un contrat déployé"} |`,
    `| Délai de détection, arrivée → détection | ${delai(delais?.porte?.arrivee_detection)} | Détection par la porte d'entrée |`,
    `| Délai de réponse, détection → pause | ${delai(delais?.porte?.detection_pause)} | Détection par la porte d'entrée ; pause hors chaîne |`,
    `| Délai de réponse, détection → alerte | ${delai(delais?.porte?.detection_alerte)} | Détection par la porte d'entrée |`,
    `| Délai de réponse, détection → pause | ${delai(delais?.contrat?.detection_pause)} | Détection par le contrat : part de l'horodatage du bloc |`,
    `| Délai de réponse, détection → alerte | ${delai(delais?.contrat?.detection_alerte)} | Détection par le contrat : part de l'horodatage du bloc |`,
    "",
    "Fichiers de mesure lus :",
    "",
    `- \`docs/mesures/bench-test.json\` : ${banc ? origine(origineBanc) : "absent"}`,
    `- \`docs/mesures/bench-reference.json\` : ${reference ? origine(origineReference) : "absent"}`,
    `- \`docs/mesures/delais.json\` : ${delais ? origine(delais) : "absent"}`,
    `- \`docs/mesures/demo.json\` : ${demo ? origine(demo) : "absent"}`,
  ];
  return lignes.join("\n");
}

export function rendreCasManques({ banc, origineBanc }) {
  if (!banc) return "Aucune mesure enregistrée : cette section est vide. Elle se remplit avec le tableau de métriques, depuis le même fichier.";
  const t = banc.test;
  const familles = Object.entries(t.recall_by_family).sort(([a], [b]) => a.localeCompare(b));
  const nom = (texte) => String(texte).replace(/[^\w-]/g, "");
  return [
    `Détecteur \`${banc.detector_version}\`, seuil ${t.threshold}, ${origine(origineBanc)}.`,
    "",
    "| Famille d'attaque | Détectées | Manquées |",
    "|---|---:|---:|",
    ...familles.map(([famille, f]) => `| \`${nom(famille)}\` | ${f.detected} sur ${f.attacks} | ${f.attacks - f.detected} |`),
    "",
    `Attaques manquées (${t.false_negatives}) : ${t.false_negatives === 0 ? "aucune" : t.missed_attack_ids.join(", ")}.`,
    "",
    `Demandes légitimes bloquées (${t.false_positives}) : ${t.false_positives === 0 ? "aucune" : t.false_positive_ids.join(", ")}.`,
  ].join("\n");
}

// Limite du jeu à un pour un : elle cite le taux de faux positifs, donc elle sort de la mesure.
export function rendreLimiteJeu({ banc }) {
  const t = banc?.test;
  if (!t || t.attacks !== t.legit || t.false_positives === 0) return "- 1 attaque pour 1 légitime est un choix de mesure, pas la fréquence réelle des attaques.";
  const part = decimal(Number((t.false_positive_rate * 100).toFixed(1)));
  return `- Le jeu est à un pour un (${t.attacks} attaques, ${t.legit} demandes légitimes). En production, les attaques sont rares : avec ${part} % de faux positifs, la majorité des blocages seraient des demandes légitimes bloquées. Les chiffres valent pour ce jeu synthétique, pas pour le monde réel.`;
}

function remplacer(texte, [debut, fin], contenu) {
  const i = texte.indexOf(debut);
  const j = texte.indexOf(fin);
  if (i === -1 || j === -1 || j < i) throw new MesureInvalide(`marqueurs absents de la fiche : ${debut}`);
  return `${texte.slice(0, i + debut.length)}\n${contenu}\n${texte.slice(j)}`;
}

/** Texte que la fiche doit avoir, compte tenu des fichiers de mesure présents. */
export function ficheAttendue(texte, mesures = charger()) {
  const avecBlocs = remplacer(remplacer(texte, MARQUEURS.metriques, rendreMetriques(mesures)), MARQUEURS.casManques, rendreCasManques(mesures));
  return remplacer(avecBlocs, MARQUEURS.limiteJeu, rendreLimiteJeu(mesures));
}

/** Liste des écarts entre la fiche et ses fichiers de mesure. Vide : tout va bien. */
export function verifierFiche(chemin = FICHE) {
  try {
    const texte = readFileSync(chemin, "utf8");
    return ficheAttendue(texte) === texte ? [] : ["le tableau de métriques ou les cas manqués ne sortent pas des fichiers de mesure : relancer node docs/outils/remplir-fiche.mjs"];
  } catch (erreur) {
    if (erreur instanceof MesureInvalide) return [erreur.message];
    throw erreur;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const controle = process.argv.includes("--check");
  try {
    if (controle) {
      const ecarts = verifierFiche();
      for (const ecart of ecarts) console.error(`fiche : ${ecart}`);
      process.exitCode = ecarts.length === 0 ? 0 : 1;
    } else {
      const texte = readFileSync(FICHE, "utf8");
      const attendu = ficheAttendue(texte);
      if (attendu !== texte) writeFileSync(FICHE, attendu);
      console.log(attendu === texte ? "fiche : déjà à jour" : "fiche : tableau de métriques et cas manqués réécrits");
    }
  } catch (erreur) {
    if (!(erreur instanceof MesureInvalide)) throw erreur;
    console.error(`fiche : ${erreur.message}`);
    process.exitCode = 2;
  }
}
