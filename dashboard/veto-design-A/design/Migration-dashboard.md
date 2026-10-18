# Migration depuis le dashboard actuel

Les jetons gardent les noms de `dashboard/src/styles.css` (en français) : `fond`, `surface`, `surface-2`, `texte`, `discret`, `trait`, `accent`, `accent-fond`, `refuse`, `humain`, `accepte`, `bloque`, `simulation` et leurs `-fond`, plus les `entete-*`. On remplace les valeurs, on ajoute quelques jetons, et le code des composants ne change presque pas. Le dashboard garde sa CSP stricte : aucune ressource externe, aucun style en attribut.

| Jeton | Valeur actuelle (clair) | Valeur proposée (clair) |
|---|---|---|
| `fond` | `#f5f5f9` | `#eeebf3` |
| `surface` | `#ffffff` | `#faf8fc` |
| `texte` | `#1b1d2b` | `#1e1730` |
| `discret` | `#585c6e` | `#554f6b` |
| `trait` | `#e3e2ec` | `#d2cddd` |
| `accent` | `#5b41c8` | `#2e1a6b` |
| `refuse` | `#b3202e` | `#a02f12` |
| `humain` | `#875000` | `#714500` |
| `accepte` | `#0f6b57` | `#146158` |
| `bloque` | `#4c5363` | `#4a4564` |
| `simulation` | `#0b5b6a` | `#2f4690` |
| `entete-fond` | `#1d2230` | `#1e1730` |

Ce qui change de sens : le rouge `refuse` (`#b3202e`) devient un orange brûlé, ce qui sépare le veto de l'alerte système et laisse la sarcelle seule porter « payé ». `simulation` passe du bleu-vert au bleu pour ne plus ressembler à `accepte`.

Jetons ajoutés : `-signal` (aplats), `sur-signal`, `on-accent`, `trait-fort`, `siege`, `table`, `table-v`, `papier`, `focus`, `lueur-couleur`, `viz-cat-1` à `viz-seq-5`. Remplacés : `--ombre` par `relief` et `lueur`, `--rayon` reste à 16 px, `--mono` et `--sans` par `--font-mono` et `--font-sans` (Plex Mono, Jost, fichiers locaux ; le dashboard nomme aujourd'hui Inter sans le charger).

Composants du dashboard repris : `DecisionBadge` et `ToneBadge` (`PastilleDecision`, avec le chiffre 0/1/2), `PlaceableBar` (`BarreTresorerie`), `CountdownRing` (remplacé par l'échéance de `CarteValidation`, en date et heures), `Banners` (`EtatErreur`, bandeau simulé), `FlowDiagram` (remplacé par `TableRonde` : cinq couches, pas de flux en éventail), `SourceTag` (`EtiquetteSource`).

À ne pas reprendre de la maquette « Argent Intelligent » : détecteurs A et B, votes, onglet Validateurs, consensus, l'ancien logo « A », cartes imbriquées.

Ajouts hors dépôt actuel : écrans de connexion, de mise en service et de preuves, et vue mobile. Ils sont à bâtir côté `dashboard/` : la connexion suppose un fournisseur d'identité (SSO) devant le proxy local, et la mise en service ne lit que des `GET`. L'échéance, les notifications et les rappels dépendent de ce que le relais et le contrat exposent : le dashboard affiche l'échéance donnée et ne calcule aucun jour ouvré.
