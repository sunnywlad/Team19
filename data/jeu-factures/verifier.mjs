#!/usr/bin/env node
// Contrôle le jeu de factures : format, effectifs, empreintes, doublons, secrets.
// Usage : node data/jeu-factures/verifier.mjs
// Sort en code 1 à la première série d'erreurs. Ne lance aucun détecteur.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));

const FICHIERS = {
  "dev.jsonl": { prefixe: "d", lignes: 120, legit: 60, attack: 60, minParFamilleAttaque: 4 },
  "test.jsonl": { prefixe: "t", lignes: 200, legit: 100, attack: 100, minParFamilleAttaque: 8 },
};
const CHAMPS = ["id", "label", "family", "action", "mandate", "document"];
const ETIQUETTES = ["legit", "attack"];
const ACTIONS = ["PAY_INVOICE", "PLACE"];
const FAMILLES_ATTAQUE = [
  "instruction-directe",
  "instruction-cachee",
  "fausse-autorite",
  "changement-role",
  "politique-levee",
  "pression-urgence",
  "changement-coordonnees",
  "montant-rectifie",
  "doublon-facture",
  "hors-mandat",
  "instruction-fragmentee",
  "obfuscation",
];
const FAMILLE_DIFFICILE = "cas-difficile";
const PART_DIFFICILE_MIN = 0.25;
const LONGUEUR_MAX = 8192;
// Similarité de Jaccard sur les triplets de mots au-delà de laquelle deux
// documents sont tenus pour des quasi-copies.
const SEUIL_QUASI_DOUBLON = 0.5;

const erreurs = [];
const erreur = (message) => erreurs.push(message);

// --- Motifs de secrets -------------------------------------------------------
// Les motifs sont assemblés par morceaux pour que ce fichier ne ressemble pas
// lui-même à un secret aux yeux des scanners du dépôt.
const TIRETS = "-".repeat(5);
const MOTIFS_SECRETS = [
  ["clé privée PEM", new RegExp(TIRETS + "BEGIN [A-Z0-9 ]*PRIVATE " + "KEY")],
  ["clé privée hexadécimale (64 caractères)", /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/],
  ["jeton GitHub", new RegExp("\\b(?:gh[pousr]|github_pat)" + "_[A-Za-z0-9_]{20,}")],
  ["clé d'API de type sk-", new RegExp("\\b" + "sk" + "-[A-Za-z0-9_-]{20,}")],
  ["identifiant de clé AWS", new RegExp("\\b" + "AK" + "IA[0-9A-Z]{16}\\b")],
  ["jeton Slack", new RegExp("\\b" + "xo" + "x[baprs]-[A-Za-z0-9-]{10,}")],
  ["clé d'API Google", new RegExp("\\b" + "AI" + "za[0-9A-Za-z_-]{35}\\b")],
  ["jeton JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
];

// Longueur d'un IBAN par pays ; pour un pays absent, toutes les longueurs
// possibles sont essayées.
const LONGUEUR_IBAN = { BE: 16, CH: 21, DE: 22, ES: 24, FR: 27, GB: 22, IT: 27, LT: 20, LU: 20, NL: 18, PT: 25 };
const CANDIDAT_IBAN = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?:[  ]?[A-Z0-9]){11,30}/g;

function ibanValide(compact) {
  const reordonne = compact.slice(4) + compact.slice(0, 4);
  let reste = 0;
  for (const c of reordonne) {
    const valeur = c >= "0" && c <= "9" ? c : String(c.charCodeAt(0) - 55);
    for (const chiffre of valeur) reste = (reste * 10 + Number(chiffre)) % 97;
  }
  return reste === 1;
}

function ibansValides(texte) {
  const trouves = [];
  for (const [candidat] of texte.matchAll(CANDIDAT_IBAN)) {
    const compact = candidat.replace(/[  ]/g, "");
    const fixe = LONGUEUR_IBAN[compact.slice(0, 2)];
    const longueurs = fixe ? [fixe] : Array.from({ length: 20 }, (_, i) => i + 15);
    for (const n of longueurs) {
      if (compact.length >= n && ibanValide(compact.slice(0, n))) trouves.push(compact.slice(0, n));
    }
  }
  return trouves;
}

// Les charges utiles en base64 sont décodées pour être contrôlées elles aussi.
function textesAControler(document) {
  const textes = [document];
  for (const [bloc] of document.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)) {
    textes.push(Buffer.from(bloc, "base64").toString("utf8"));
  }
  return textes;
}

// --- Quasi-doublons ----------------------------------------------------------
function normaliser(document) {
  return document
    .normalize("NFKD")
    .replace(/[̀-ͯ​-‍⁠﻿]/g, "")
    .replace(/[\u{e0000}-\u{e007f}]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function triplets(normalise) {
  const mots = normalise.split(" ");
  const ensemble = new Set();
  for (let i = 0; i + 2 < mots.length; i++) ensemble.add(`${mots[i]} ${mots[i + 1]} ${mots[i + 2]}`);
  if (ensemble.size === 0) ensemble.add(normalise);
  return ensemble;
}

function jaccard(a, b) {
  let commun = 0;
  for (const x of a) if (b.has(x)) commun++;
  return commun / (a.size + b.size - commun);
}

// --- Lecture et contrôle d'un fichier ----------------------------------------
function lire(nom, attendu) {
  const brut = readFileSync(join(ICI, nom));
  const texte = brut.toString("utf8");
  if (!texte.endsWith("\n")) erreur(`${nom} : pas de saut de ligne final`);
  const lignes = texte.split("\n").slice(0, -1);
  const echantillons = [];
  const ids = new Set();

  lignes.forEach((ligne, i) => {
    const ou = `${nom}:${i + 1}`;
    let e;
    try {
      e = JSON.parse(ligne);
    } catch {
      return erreur(`${ou} : JSON invalide`);
    }
    if (e === null || typeof e !== "object" || Array.isArray(e)) return erreur(`${ou} : objet attendu`);
    if (JSON.stringify(Object.keys(e)) !== JSON.stringify(CHAMPS)) {
      return erreur(`${ou} : champs attendus ${CHAMPS.join(", ")}, reçus ${Object.keys(e).join(", ")}`);
    }
    const idAttendu = `${attendu.prefixe}-${String(i + 1).padStart(3, "0")}`;
    if (e.id !== idAttendu) erreur(`${ou} : id ${JSON.stringify(e.id)}, attendu ${idAttendu}`);
    if (ids.has(e.id)) erreur(`${ou} : id en double ${e.id}`);
    ids.add(e.id);
    if (!ETIQUETTES.includes(e.label)) erreur(`${ou} : étiquette inconnue ${JSON.stringify(e.label)}`);
    if (!ACTIONS.includes(e.action)) erreur(`${ou} : action inconnue ${JSON.stringify(e.action)}`);
    if (typeof e.family !== "string" || !/^[a-z-]{1,40}$/.test(e.family)) erreur(`${ou} : famille mal formée`);
    if (e.label === "attack" && !FAMILLES_ATTAQUE.includes(e.family)) erreur(`${ou} : famille d'attaque inconnue ${e.family}`);
    if (e.label === "legit" && FAMILLES_ATTAQUE.includes(e.family)) erreur(`${ou} : famille d'attaque sur un échantillon légitime`);
    if (
      !Array.isArray(e.mandate) ||
      e.mandate.some((m) => !ACTIONS.includes(m)) ||
      new Set(e.mandate).size !== e.mandate.length
    ) {
      erreur(`${ou} : mandat invalide`);
    } else {
      const couvert = e.mandate.includes(e.action);
      if (e.label === "legit" && !couvert) erreur(`${ou} : échantillon légitime dont l'action sort du mandat`);
      if (e.family === "hors-mandat" && couvert) erreur(`${ou} : famille hors-mandat mais action couverte par le mandat`);
    }
    if (typeof e.document !== "string" || e.document.trim() === "") return erreur(`${ou} : document vide`);
    if (e.document.length > LONGUEUR_MAX) erreur(`${ou} : document de ${e.document.length} caractères (max ${LONGUEUR_MAX})`);

    for (const t of textesAControler(e.document)) {
      for (const [quoi, motif] of MOTIFS_SECRETS) if (motif.test(t)) erreur(`${ou} : motif de secret (${quoi})`);
      for (const iban of ibansValides(t)) erreur(`${ou} : IBAN à somme de contrôle valide (${iban.slice(0, 4)}…)`);
    }
    const normalise = normaliser(e.document);
    echantillons.push({ ...e, ou, normalise, triplets: triplets(normalise) });
  });

  // Effectifs imposés.
  const compte = (pred) => echantillons.filter(pred).length;
  if (lignes.length !== attendu.lignes) erreur(`${nom} : ${lignes.length} lignes, ${attendu.lignes} attendues`);
  for (const etiquette of ETIQUETTES) {
    const n = compte((e) => e.label === etiquette);
    if (n !== attendu[etiquette]) erreur(`${nom} : ${n} ${etiquette}, ${attendu[etiquette]} attendus`);
  }
  for (const famille of FAMILLES_ATTAQUE) {
    const n = compte((e) => e.label === "attack" && e.family === famille);
    if (n < attendu.minParFamilleAttaque) erreur(`${nom} : ${n} ${famille}, au moins ${attendu.minParFamilleAttaque} attendus`);
  }
  const difficiles = compte((e) => e.family === FAMILLE_DIFFICILE);
  if (difficiles < PART_DIFFICILE_MIN * attendu.legit) {
    erreur(`${nom} : ${difficiles} cas difficiles, au moins ${PART_DIFFICILE_MIN * attendu.legit} attendus`);
  }

  // Doublons exacts dans le fichier.
  const vus = new Map();
  for (const e of echantillons) {
    if (vus.has(e.normalise)) erreur(`${e.ou} : même document que ${vus.get(e.normalise)}`);
    else vus.set(e.normalise, e.ou);
  }

  const familles = { legit: {}, attack: {} };
  for (const e of echantillons) {
    if (familles[e.label]) familles[e.label][e.family] = (familles[e.label][e.family] ?? 0) + 1;
  }
  return { echantillons, familles, sha256: createHash("sha256").update(brut).digest("hex") };
}

const lus = {};
for (const [nom, attendu] of Object.entries(FICHIERS)) lus[nom] = lire(nom, attendu);

// --- Doublons et quasi-doublons entre dev et test ----------------------------
let pireSimilarite = 0;
for (const d of lus["dev.jsonl"].echantillons) {
  for (const t of lus["test.jsonl"].echantillons) {
    if (d.normalise === t.normalise) {
      erreur(`${d.ou} et ${t.ou} : doublon exact entre dev et test`);
      continue;
    }
    const s = jaccard(d.triplets, t.triplets);
    if (s > pireSimilarite) pireSimilarite = s;
    if (s >= SEUIL_QUASI_DOUBLON) erreur(`${d.ou} et ${t.ou} : quasi-doublon (similarité ${s.toFixed(2)})`);
  }
}

// --- MANIFEST ----------------------------------------------------------------
let manifeste;
try {
  manifeste = JSON.parse(readFileSync(join(ICI, "MANIFEST.json"), "utf8"));
} catch {
  erreur("MANIFEST.json : absent ou JSON invalide");
}
if (manifeste) {
  if (manifeste.synthetique !== true) erreur("MANIFEST.json : la mention « synthetique » doit valoir true");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifeste.date ?? "")) erreur("MANIFEST.json : date absente ou mal formée");
  if (typeof manifeste.methode !== "string" || manifeste.methode.length < 40) erreur("MANIFEST.json : méthode absente");
  for (const [nom, attendu] of Object.entries(FICHIERS)) {
    const declare = manifeste.fichiers?.[nom];
    const reel = lus[nom];
    if (!declare) {
      erreur(`MANIFEST.json : entrée ${nom} absente`);
      continue;
    }
    if (declare.sha256 !== reel.sha256) erreur(`MANIFEST.json : SHA-256 de ${nom} différent du fichier`);
    if (declare.lignes !== reel.echantillons.length) erreur(`MANIFEST.json : nombre de lignes de ${nom} inexact`);
    for (const etiquette of ETIQUETTES) {
      if (declare.etiquettes?.[etiquette] !== attendu[etiquette]) erreur(`MANIFEST.json : effectif ${etiquette} de ${nom} inexact`);
      const a = JSON.stringify(Object.entries(declare.familles?.[etiquette] ?? {}).sort());
      const b = JSON.stringify(Object.entries(reel.familles[etiquette]).sort());
      if (a !== b) erreur(`MANIFEST.json : effectifs par famille (${etiquette}) de ${nom} inexacts`);
    }
    const ids = new Set(reel.echantillons.map((e) => e.id));
    for (const [langue, liste] of Object.entries(declare.langues_hors_francais ?? {})) {
      for (const id of liste) if (!ids.has(id)) erreur(`MANIFEST.json : ${id} (${langue}) absent de ${nom}`);
    }
  }
}

if (erreurs.length > 0) {
  for (const e of erreurs) console.error(`ERREUR  ${e}`);
  console.error(`\n${erreurs.length} erreur(s).`);
  process.exit(1);
}
for (const [nom, { echantillons }] of Object.entries(lus)) console.log(`OK  ${nom} : ${echantillons.length} échantillons`);
console.log(`OK  MANIFEST.json : effectifs et empreintes concordent`);
console.log(`OK  aucun doublon ; similarité maximale entre dev et test : ${pireSimilarite.toFixed(2)} (seuil ${SEUIL_QUASI_DOUBLON})`);
console.log("OK  aucun motif de secret, aucun IBAN à somme de contrôle valide");
