#!/usr/bin/env node
// Contrôle des livrables : README.md à la racine, tout docs/**/*.md et tout
// docs-jury/**/*.md.
//
//   node docs/outils/verifier-docs.mjs      (cible « make docs »)
//
// Échec si :
//   1. une formule interdite apparaît hors d'un bloc « ce que nous ne disons pas » ;
//   2. un lien relatif ou un chemin cité entre accents graves n'existe pas ;
//   3. un motif de secret ou de coordonnée bancaire est présent ;
//   4. « le contrat paie » est écrit sans « réseau de test » dans le même paragraphe ;
//   5. la fiche de défense porte un chiffre qui ne sort pas d'un fichier de
//      mesure, ou un pourcentage est écrit ailleurs que dans ses blocs générés.
//
// docs-jury/ (marché de vérification, hors chemin de démo) : mêmes contrôles,
// sauf deux. Ses preuves recopient des hachages de transaction et des
// identifiants de demande, donc pas de motif « 64 chiffres hexadécimaux » ; ses
// pourcentages sont des paramètres de sanction, pas des chiffres de détection.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MARQUEURS, verifierFiche } from "./remplir-fiche.mjs";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const BLOC_DEBUT = "<!-- ce-que-nous-ne-disons-pas:debut -->";
const BLOC_FIN = "<!-- ce-que-nous-ne-disons-pas:fin -->";

// Formules de CHECKLIST, « Pitch ». Les espaces couvrent aussi un retour à la ligne.
const FORMULES = [
  ["protégé contre l'injection", /protég[ée]e?s?\s+contre\s+(?:l['’]\s*|les\s+)?injections?/giu],
  ["zéro attaque réussie", /z[ée]ro\s+attaques?\s+r[ée]ussies?/giu],
  ["conforme", /(?<![\p{L}\d])conformes?(?![\p{L}\d])/giu],
  ["certifié", /(?<![\p{L}\d])certifi[ée]e?s?(?![\p{L}\d])/giu],
  ["détecte les zero-days", /z[ée]ro[\s-]?days?/giu],
];

// Seule forme admise du mot : « conforme à specs/… », qui renvoie à une spec du
// dépôt et non à un texte réglementaire. Exacte : singulier, une espace de
// chaque côté de « à », la majuscule de début de phrase seule tolérée.
const CONFORME_A_SPEC = /^[Cc]onforme à specs\//;

/** Les formules interdites d'un texte, déjà privé de ses blocs autorisés : [formule, index]. */
export function formulesInterdites(texte) {
  const trouvees = [];
  for (const [formule, motif] of FORMULES) {
    for (const trouve of texte.matchAll(motif)) {
      if (formule === "conforme" && CONFORME_A_SPEC.test(texte.slice(trouve.index))) continue;
      trouvees.push([formule, trouve.index]);
    }
  }
  return trouvees;
}

const HEX_64 = new Set(["valeur de 32 octets en hexadécimal (clé ou identifiant en clair)", "empreinte ou clé de 64 chiffres hexadécimaux"]);
const SECRETS = [
  ["clé privée PEM", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["valeur de 32 octets en hexadécimal (clé ou identifiant en clair)", /0x[0-9a-fA-F]{64}/],
  ["empreinte ou clé de 64 chiffres hexadécimaux", /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/],
  ["clé d'API", /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{20,}/],
  ["jeton GitHub", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
  ["identifiant de clé AWS", /\bAKIA[0-9A-Z]{16}\b/],
  ["jeton Slack", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["jeton JWT", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/],
  ["variable secrète renseignée", /\b(?:[A-Z][A-Z0-9_]*_)?(?:KEY|KEYS|TOKEN|SECRET|PASSWORD|SIGNER|RELAYER)\s*=\s*(?!\$|<|…|\.\.\.)["']?[A-Za-z0-9+/_-]{8,}/],
  ["IBAN", /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,}/],
];

// Chemins cités : un mot entre accents graves qui commence par un dossier du dépôt.
const DOSSIERS = ["specs", "relay", "gateway", "response", "dashboard", "data", "docs", "scripts", "script", "src", "test", "offchain", "l1", ".github"];
const FICHIERS_RACINE = ["Makefile", "CLAUDE.md", "README.md", ".env.example", ".gitignore", ".gitleaks.toml", "foundry.toml"];
// Fichiers de mesure : cités partout, absents tant que rien n'est mesuré.
const MESURES_ATTENDUES = new Set(
  ["bench-test.json", "bench-test.meta.json", "bench-reference.json", "bench-reference.meta.json", "delais.json", "demo.json"].map((f) => join("docs", "mesures", f)),
);

function fichiersMarkdown(dossier) {
  const trouves = [];
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name);
    if (entree.isDirectory()) trouves.push(...fichiersMarkdown(chemin));
    else if (entree.name.endsWith(".md")) trouves.push(chemin);
  }
  return trouves;
}

const ligneDe = (texte, index) => texte.slice(0, index).split("\n").length;

/** Remplace par des espaces, sans changer ni la longueur ni les lignes. */
const blanchir = (texte, debut, fin) => texte.slice(0, debut) + texte.slice(debut, fin).replace(/[^\n]/g, " ") + texte.slice(fin);

function sansBlocsAutorises(texte, signaler) {
  let reste = texte;
  for (;;) {
    const debut = reste.indexOf(BLOC_DEBUT);
    const fin = reste.indexOf(BLOC_FIN);
    if (debut === -1 && fin === -1) return reste;
    if (debut === -1 || fin < debut) {
      signaler(ligneDe(reste, Math.max(debut, fin)), "bloc « ce que nous ne disons pas » mal fermé");
      return reste;
    }
    reste = blanchir(reste, debut, fin + BLOC_FIN.length);
  }
}

function sansBlocsDeCode(texte) {
  return texte.replace(/^```[\s\S]*?^```/gm, (bloc) => bloc.replace(/[^\n]/g, " "));
}

function existe(fichier, cible) {
  const candidats = [resolve(dirname(fichier), cible), resolve(RACINE, cible)];
  if (candidats.some((c) => MESURES_ATTENDUES.has(relative(RACINE, c)))) return true;
  return candidats.some((c) => c.startsWith(RACINE) && existsSync(c));
}

function controler(fichier) {
  const erreurs = [];
  const nom = relative(RACINE, fichier);
  const signaler = (ligne, message) => erreurs.push(`${nom}:${ligne} : ${message}`);
  const texte = readFileSync(fichier, "utf8");
  const jury = nom.split(sep)[0] === "docs-jury";

  // 1. Formules interdites.
  const hors = sansBlocsAutorises(texte, signaler);
  for (const [formule, index] of formulesInterdites(hors)) signaler(ligneDe(hors, index), `formule interdite hors bloc autorisé : « ${formule} »`);

  // Cadrage du paiement : le contrat ne paie que sur réseau de test.
  let debut = 0;
  for (const paragraphe of texte.split(/\n[ \t]*\n/)) {
    if (/contrat\s+paie/iu.test(paragraphe) && !/réseau\s+de\s+test/iu.test(paragraphe)) {
      signaler(ligneDe(texte, debut + paragraphe.search(/contrat\s+paie/iu)), "« le contrat paie » sans « sur réseau de test » dans le même paragraphe");
    }
    debut += paragraphe.length + 2;
  }

  // 2. Liens relatifs et chemins cités.
  const prose = sansBlocsDeCode(texte);
  for (const trouve of prose.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
    const cible = trouve[1];
    if (/^(?:https?:|mailto:|#)/.test(cible)) continue;
    const chemin = decodeURIComponent(cible.split("#")[0]);
    if (chemin !== "" && !existe(fichier, chemin)) signaler(ligneDe(prose, trouve.index), `lien vers un fichier absent : ${cible}`);
  }
  for (const trouve of prose.matchAll(/`([^`\n]+)`/g)) {
    const cite = trouve[1];
    if (!/^[\w.\-/]+$/.test(cite)) continue;
    const chemin = cite.replace(/^\.\//, "");
    const premier = chemin.split("/")[0];
    const estChemin = (chemin.includes("/") && DOSSIERS.includes(premier)) || FICHIERS_RACINE.includes(chemin);
    if (estChemin && !existe(fichier, chemin)) signaler(ligneDe(prose, trouve.index), `chemin cité absent du dépôt : ${cite}`);
  }

  // 3. Secrets et coordonnées bancaires, partout, blocs autorisés compris.
  texte.split("\n").forEach((ligne, i) => {
    for (const [quoi, motif] of SECRETS) if (!(jury && HEX_64.has(quoi)) && motif.test(ligne)) signaler(i + 1, `motif de secret ou de donnée réelle : ${quoi}`);
  });

  // 4. Pourcentages : seulement dans les blocs générés de la fiche.
  let sansGenere = prose;
  if (nom === join("docs", "fiche-defense.md")) {
    for (const [debut, fin] of Object.values(MARQUEURS)) {
      const i = sansGenere.indexOf(debut);
      const j = sansGenere.indexOf(fin);
      if (i !== -1 && j > i) sansGenere = blanchir(sansGenere, i, j);
    }
  }
  for (const trouve of jury ? [] : sansGenere.matchAll(/\d\s*(?:%|pour\s+cent\b)/g)) {
    signaler(ligneDe(sansGenere, trouve.index), "pourcentage écrit à la main : un chiffre mesuré ne vit que dans les blocs générés de la fiche de défense");
  }
  return erreurs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fichiers = [join(RACINE, "README.md"), ...fichiersMarkdown(join(RACINE, "docs")).sort(), ...fichiersMarkdown(join(RACINE, "docs-jury")).sort()];
  const erreurs = fichiers.flatMap(controler);
  for (const ecart of verifierFiche()) erreurs.push(`docs/fiche-defense.md : ${ecart}`);

  for (const erreur of erreurs) console.error(erreur);
  if (erreurs.length > 0) {
    console.error(`docs : ${erreurs.length} défaut(s) dans ${fichiers.length} fichier(s)`);
    process.exitCode = 1;
  } else {
    console.log(`docs : ${fichiers.length} fichier(s) contrôlé(s), aucun défaut`);
  }
}
