# Fichiers de mesure

Ce dossier reçoit les mesures qui alimentent la [fiche de défense](../fiche-defense.md).
Il est vide tant que rien n'est mesuré : la fiche affiche alors « à mesurer ».

Après chaque dépôt de fichier :

```bash
node docs/outils/remplir-fiche.mjs
```

```bash
make docs
```

Une mesure sans date ni commande est refusée par le script.

## Détecteur : `bench-test.json` et `bench-test.meta.json`

Mesure finale, **une seule fois, règles figées** (`data/jeu-factures/README.md`,
« Règle d'usage »). La commande se lance depuis `gateway/`, sur
`../data/jeu-factures/test.jsonl`, avec `--json` ; sa sortie devient
`bench-test.json`. Elle n'est volontairement pas écrite ici en bloc à copier :
la lancer trop tôt consomme le jeu de test.

`bench-test.meta.json` accompagne la sortie :

```json
{
  "date": "AAAA-MM-JJ",
  "commande": "la commande lancée, telle quelle",
  "commit": "empreinte du commit des règles mesurées",
  "jeu_sha256": "SHA-256 de test.jsonl, lu dans le MANIFEST"
}
```

Le script refuse la mesure si `jeu_sha256` n'est pas celui du MANIFEST, ou si
les identifiants ne sont pas ceux du jeu de test.

À savoir : le banc mesure par défaut tout le fichier qu'il reçoit
(`gateway/src/bench.ts`). Il n'en écarte un tiers pour le réglage (`isTuning`)
qu'avec `--split`, qui ne s'emploie pas ici. Sur `test.jsonl`, il mesure donc
les 100 légitimes et 100 attaques du fichier. La fiche affiche le nombre
réellement mesuré.

## Référence « règles fixes » : `bench-reference.json`

Même format que la sortie du banc, avec son `bench-reference.meta.json` (`date`,
`commande`). Aucune référence « seuil de montant et liste de bénéficiaires »
n'existe dans le dépôt aujourd'hui : la ligne reste « à mesurer ».

## Délais : `delais.json`

Calculés sur les rapports d'incident (`GET /incidents` du service de réponse,
champ `timestamps`), selon [specs/05-incident.md](../../specs/05-incident.md) § 5.
Aucun outil du dépôt ne produit ce fichier aujourd'hui.

```json
{
  "date": "AAAA-MM-JJ",
  "commande": "la commande ou le script qui a produit ces valeurs",
  "porte": {
    "arrivee_detection": { "n": 0, "mediane_ms": 0, "max_ms": 0 },
    "detection_pause": { "n": 0, "mediane_ms": 0, "max_ms": 0 },
    "detection_alerte": { "n": 0, "mediane_ms": 0, "max_ms": 0 }
  },
  "contrat": {
    "detection_pause": { "n": 0, "mediane_ms": 0, "max_ms": 0 },
    "detection_alerte": { "n": 0, "mediane_ms": 0, "max_ms": 0 }
  }
}
```

`n` est le nombre d'incidents mesurés, au moins 1. Un bloc absent reste « à
mesurer ». Le bloc `contrat` demande un contrat déployé.

## Démo de bout en bout : `demo.json`

```json
{
  "date": "AAAA-MM-JJ",
  "commande": "la commande qui a joué la scène",
  "coffre": "faux coffre, doublure de test ou contrat déployé",
  "attaques_jouees": 0,
  "passees_porte_bloquees_contrat": 0,
  "sorties_de_fonds": 0
}
```

`coffre` s'affiche à côté du chiffre : une scène jouée sur le faux coffre ne
prouve rien sur des fonds réels.

Ce fichier ne s'écrit pas à la main : `node demo/mesure-scenes.mjs` le produit à
partir de la sortie de `make scenes` jouée en `VAULT_MODE=chain`, et refuse de
l'écrire sinon. Il y ajoute `commit` et `cas`, la classification de chaque scène
(attaque ou non, passée la porte, décision du contrat, sortie de fonds) ; la
règle est écrite en tête du script.
