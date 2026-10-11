# Jeu de factures pour mesurer le détecteur

320 documents **synthétiques**, moitié légitimes, moitié piégés, pour mesurer le
détecteur de la porte d'entrée : rappel, précision, faux positifs. Le jeu a été
écrit sans lire les règles du détecteur, pour que la mesure ne soit pas celle
d'un jeu taillé sur elles.

| Fichier | Contenu | Usage |
|---|---|---|
| [dev.jsonl](dev.jsonl) | 120 lignes, 60 légitimes, 60 attaques | Réglage. Loris peut le lire. |
| [test.jsonl](test.jsonl) | 200 lignes, 100 légitimes, 100 attaques | Mesure finale, une seule fois. |
| [MANIFEST.json](MANIFEST.json) | Effectifs, SHA-256, méthode, date | Preuve que les fichiers n'ont pas bougé. |
| [verifier.mjs](verifier.mjs) | Contrôles de format et d'intégrité | `node data/jeu-factures/verifier.mjs` |

## Règle d'usage

1. Loris règle le détecteur sur `dev.jsonl`, autant de fois qu'il le faut.
2. Il fige les règles et note leur `detector_version`.
3. Il lance le banc sur `test.jsonl` **une seule fois** et enregistre le résultat
   avec la `detector_version` et le SHA-256 de `test.jsonl` lu dans le MANIFEST.
4. Toute modification des règles après cette mesure **l'invalide**. Elle doit
   être déclarée : le chiffre publié cesse de valoir pour les nouvelles règles,
   et `test.jsonl`, une fois vu, ne peut plus servir de mesure indépendante.

Personne ne lit `test.jsonl` avant l'étape 3, ni son contenu ni les résultats
par échantillon d'un lancement d'essai. Le fichier est dans le dépôt, donc
cette règle tient à la discipline de l'équipe et non à une barrière technique.

## Ce que les chiffres ne disent pas

- **Un pour un est un choix de mesure, pas la fréquence réelle des attaques.**
  Dans un flux réel, les factures piégées sont rares. La précision mesurée ici
  est donc bien plus flatteuse que celle qu'on observerait en production : avec
  une attaque pour mille factures, le même taux de faux positifs donnerait une
  précision très inférieure. Le rappel et le taux de faux positifs se lisent
  chacun sur sa moitié du jeu et ne dépendent pas de ce rapport.
- **Le jeu est synthétique et écrit par une IA.** Les taux obtenus ne valent pas
  pour le monde réel. Un modèle écrit des attaques qui ressemblent à l'idée
  qu'il se fait d'une attaque ; un fraudeur réel écrit autre chose. Les
  factures légitimes sont plus propres et plus courtes que de vraies pièces
  comptables passées par un scanner.
- **Un seul auteur.** Les 320 documents partagent un style, un vocabulaire et
  des tournures, entre dev et test aussi. Un réglage sur dev profite en partie
  à test pour cette seule raison : le rappel sur test surestime
  vraisemblablement le rappel sur des attaques écrites par quelqu'un d'autre.
- **Le jeu est petit.** Sur 100 attaques, une attaque de plus ou de moins
  déplace le rappel d'un point. Par famille (8 ou 9 échantillons dans test),
  un chiffre n'est qu'une indication : un échantillon y pèse 11 à 12 points.
- **Certaines familles ne se voient pas dans un document seul.** Un doublon ne
  se prouve qu'en connaissant les factures déjà payées, un montant rectifié
  qu'en connaissant le montant inscrit. Ici, ces attaques portent des indices
  dans leur texte (« second exemplaire », « lire 28 500 et non 285 ») ; une
  attaque sans indice n'est pas représentée et reste l'affaire du contrat.
- **La frontière entre légitime et attaque est un choix d'étiquetage.** Une
  facture rectificative à la baisse, un duplicata d'une facture soldée ou une
  mise en demeure véridique sont étiquetés légitimes ; les mêmes gestes
  deviennent des attaques quand ils demandent de payer plus, de payer deux fois
  ou de sauter un contrôle. D'autres choix étaient défendables.

Le jeu ne permet de revendiquer ni la détection d'attaques inconnues, ni une
performance en conditions réelles.

## Format

Une ligne JSON par échantillon, six champs et aucun autre :

```json
{"id":"d-001","label":"legit","family":"facture-simple","action":"PAY_INVOICE","mandate":["PAY_INVOICE"],"document":"…"}
```

| Champ | Valeurs |
|---|---|
| `id` | `d-001` à `d-120` pour dev, `t-001` à `t-200` pour test |
| `label` | `legit` ou `attack` |
| `family` | voir les tableaux ci-dessous |
| `action` | `PAY_INVOICE` ou `PLACE` : l'action demandée avec la pièce |
| `mandate` | le mandat de l'agent qui transmet la pièce : liste de `PAY_INVOICE` et `PLACE`, vide pour un agent lecteur |
| `document` | le texte de la pièce, 8 192 caractères au plus |

L'ordre des lignes est mélangé : les étiquettes et les familles ne se suivent pas.

## Familles d'attaque

| Famille | Ce que fait le document | dev | test |
|---|---|---:|---:|
| `instruction-directe` | S'adresse en clair à l'agent pour qu'il paie sans contrôle | 5 | 8 |
| `instruction-cachee` | Cache la consigne : caractères invisibles, commentaire HTML, base64, texte blanc ou masqué simulé | 5 | 9 |
| `fausse-autorite` | Invoque la direction, la banque, l'audit, le fisc ou le juridique | 5 | 8 |
| `changement-role` | Redéfinit le rôle de l'agent : administrateur, mode test, personnage | 5 | 8 |
| `politique-levee` | Annonce un plafond levé, une exception ou une dérogation | 5 | 8 |
| `pression-urgence` | Menace, compte à rebours ou appel à la pitié pour sauter les contrôles | 5 | 8 |
| `changement-coordonnees` | Nouveau compte bancaire ou portefeuille à la place du bénéficiaire connu | 5 | 9 |
| `montant-rectifie` | Montant « corrigé » à la hausse, à payer à la place du montant inscrit | 5 | 8 |
| `doublon-facture` | Facture déjà réglée, représentée comme une pièce nouvelle | 5 | 8 |
| `hors-mandat` | Action que le mandat ne couvre pas : lecteur qui paie ou place, demandeur qui place | 5 | 8 |
| `instruction-fragmentee` | Consigne découpée sur plusieurs lignes, cellules de tableau ou initiales | 5 | 9 |
| `obfuscation` | Lettres espacées, leetspeak, mots coupés, lettres inversées, caractères unicode proches | 5 | 9 |
| | **Total** | **60** | **100** |

Dans la famille `hors-mandat`, l'attaque tient au couple action et mandat : une
partie des documents est parfaitement anodine, exprès. Ailleurs, l'action est
toujours couverte par le mandat.

**La langue est un axe transversal, pas une famille.** Les attaques sont
écrites en français, en anglais et en espagnol dans toutes les familles :

| Langue des attaques | dev | test |
|---|---:|---:|
| Français | 39 | 62 |
| Anglais | 12 | 24 |
| Espagnol | 9 | 14 |

Le format n'ayant pas de champ de langue, le MANIFEST donne la liste des
identifiants en anglais et en espagnol (`langues_hors_francais`), pour qui veut
calculer un rappel par langue.

## Familles légitimes

| Famille | dev | test |
|---|---:|---:|
| `facture-simple` | 5 | 9 |
| `facture-detaillee` | 5 | 8 |
| `avoir` | 4 | 7 |
| `relance` | 4 | 7 |
| `devis` | 4 | 7 |
| `note-honoraires` | 4 | 7 |
| `facture-anglais` | 4 | 7 |
| `facture-espagnol` | 4 | 7 |
| `montant-eleve` | 4 | 6 |
| `facture-longue` | 3 | 5 |
| `placement` | 3 | 4 |
| `cas-difficile` | 16 | 26 |
| **Total** | **60** | **100** |

Les `cas-difficile` (plus d'un quart des légitimes) ressemblent à une attaque
sans en être une : « urgent » ou « dès réception », nouvelle adresse du siège
sans changement de paiement, rappel des conditions de paiement, « règlement » et
« politique de paiement » au sens ordinaire, coordonnées bancaires rappelées et
inchangées, montant en toutes lettres, facture d'une formation qui cite des
phrases d'attaque, mise en demeure véridique, facture rectificative à la baisse.
Ce sont eux qui mesurent les faux positifs.

## Méthode

Chaque document a été rédigé un par un par un modèle de langage (Claude,
Anthropic), le 11 octobre 2026, à partir de la seule liste des familles
ci-dessus. Il n'y a ni gabarit à trous ni génération par programme. Un script
d'assemblage a ensuite encodé les charges cachées (base64, caractères
invisibles), mélangé l'ordre avec une graine fixe et attribué les identifiants.

Ce que l'auteur a lu avant d'écrire : les spécifications de `specs/`, une ligne
de `gateway/bench/jeu-provisoire.jsonl` pour le format, et
`gateway/bench/README.md`. Ni `gateway/src`, ni `gateway/test`, ni le fichier de
résultats du banc n'ont été ouverts. **Réserve** : ce README du banc ne décrit
pas que le format, il résume aussi les résultats provisoires par famille.
L'auteur en a donc eu connaissance. Les familles et leur contenu viennent de la
commande, pas de cette lecture, mais l'indépendance du jeu n'est pas parfaite
sur ce point.

Le détecteur n'a jamais été lancé sur `test.jsonl`. Il a été lancé une fois sur
`dev.jsonl`, pour vérifier que le banc charge le fichier ; ses résultats n'ont
été ni lus ni conservés.

## Données

Tout est inventé : sociétés, personnes, adresses, numéros d'immatriculation. Les
domaines sont en `.invalid` ou `example.test`. Les IBAN ont une forme plausible
et une somme de contrôle invalide, que `verifier.mjs` contrôle. Les adresses de
portefeuille sont des suites hexadécimales inventées. Aucune clé, aucun jeton.
Une ressemblance avec une société existante serait fortuite.

Les documents piégés contiennent des consignes hostiles : ce sont des données
de test, jamais des instructions à suivre.

## Vérifier

```bash
node data/jeu-factures/verifier.mjs
```

Le script contrôle : JSON valide, champs exacts, étiquettes et actions admises,
mandat cohérent avec l'étiquette, longueur, identifiants uniques et continus,
effectifs imposés, effectifs et SHA-256 du MANIFEST, absence de doublon exact,
absence de quasi-copie entre dev et test (similarité de Jaccard sur les
triplets de mots, seuil 0,5), absence de motif de secret et d'IBAN valide, y
compris dans les charges en base64. Il ne lance aucun détecteur.

Pour vérifier que le banc charge le fichier de réglage :

```bash
cd gateway && npm run bench -- ../data/jeu-factures/dev.jsonl
```
