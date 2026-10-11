# Mesure du détecteur sur data/jeu-factures

Mesure finale, faite **une seule fois**, selon la règle d'usage de
[data/jeu-factures/README.md](../../data/jeu-factures/README.md).

## Fiche de la mesure

| | |
|---|---|
| `detector_version` | `regles-0.3` |
| Commit des règles figées | `2df8362`, poussé avant la mesure |
| Fichier mesuré | `data/jeu-factures/test.jsonl`, 200 échantillons |
| SHA-256 de `test.jsonl` | `1342dc012744df4c4f7662d2a5d761afc99705ac3f61af0448775afc0f6a160e`, identique au MANIFEST |
| Date | 10 octobre 2026, 22:45 UTC (11 octobre, 00:45 à Paris) |
| Commande | `cd gateway && npm run bench -- ../data/jeu-factures/test.jsonl --json` |
| Seuil | 70 |
| Sortie brute | [mesure-test-regles-0.3.json](mesure-test-regles-0.3.json) |

## Résultat

100 attaques, 100 demandes légitimes.

| Mesure | Valeur |
|---|---:|
| Attaques détectées (rappel) | 50 sur 100, soit 50,0 % |
| Attaques manquées | 50 sur 100 |
| Demandes légitimes bloquées (faux positifs) | 4 sur 100, soit 4,0 % |
| Précision | 92,6 % (50 blocages justes sur 54) |
| Temps de détection | 0,4 ms en moyenne, 26 ms au pire |

### Par famille d'attaque

| Famille | Détectées |
|---|---:|
| `hors-mandat` | 8 sur 8 |
| `instruction-cachee` | 7 sur 9 |
| `montant-rectifie` | 5 sur 8 |
| `changement-role` | 5 sur 8 |
| `obfuscation` | 5 sur 9 |
| `changement-coordonnees` | 5 sur 9 |
| `instruction-directe` | 4 sur 8 |
| `politique-levee` | 3 sur 8 |
| `instruction-fragmentee` | 3 sur 9 |
| `fausse-autorite` | 2 sur 8 |
| `pression-urgence` | 2 sur 8 |
| `doublon-facture` | 1 sur 8 |

Par famille, 8 ou 9 échantillons : un échantillon pèse 11 à 12 points. Ces
lignes sont des indications, pas des taux.

Les identifiants des 50 attaques manquées et des 4 faux positifs (`t-045`,
`t-046`, `t-084`, `t-095`) sont dans la sortie brute.

## Ce que le réglage avait donné

Sur `dev.jsonl`, le jeu de réglage, 60 attaques et 60 demandes légitimes :

| Version | Attaques détectées | Faux positifs |
|---|---:|---:|
| `regles-0.2`, avant réglage | 13 sur 60, soit 21,7 % | 1 sur 60 |
| `regles-0.3`, après réglage | 56 sur 60, soit 93,3 % | 0 sur 60 |

## Lecture

- **L'écart entre 93,3 % sur le réglage et 50,0 % sur la mesure est le résultat
  principal.** Les règles ont été écrites en regardant les 60 attaques de
  `dev.jsonl` : elles reconnaissent ces formulations-là, et une attaque sur deux
  quand elle est formulée autrement. C'est du surapprentissage sur le jeu de
  réglage, et c'est ce qu'une mesure séparée sert à montrer.
- **Le chiffre à citer est 50 %, pas 93 %.** Le rappel sur `dev.jsonl` n'est pas
  une mesure : c'est le jeu sur lequel les règles ont été réglées.
- **4 demandes légitimes sur 100 sont bloquées**, alors qu'aucune ne l'était sur
  le réglage. Chacune demanderait une levée de pause par un humain.
- **Une attaque sur deux passe la porte.** Le système ne tient donc pas sur le
  détecteur : il tient sur le second filet, le contrat, qui refuse une facture
  absente de son registre quel que soit le texte reçu.
- **Seule la famille `hors-mandat` est tenue en entier** : c'est une règle sans
  texte, le mandat de l'agent vient de son jeton.
- Les réserves du README du jeu valent ici : jeu synthétique, écrit par une IA,
  un seul auteur pour dev et test, attaques et demandes légitimes à un pour un.
  Avec des attaques rares, la précision serait bien plus basse à taux de faux
  positifs égal. Ces chiffres ne valent pas pour le monde réel.

## Règle après cette mesure

Les règles sont figées à `regles-0.3`. Toute modification des règles après cette
mesure **l'invalide** et doit être déclarée :

- le chiffre de 50 % cesse de valoir pour les nouvelles règles ;
- `test.jsonl` a servi : il ne peut plus donner une mesure indépendante. Une
  nouvelle mesure demanderait un nouveau jeu de mesure.

Le contenu de `test.jsonl` et le détail des échantillons manqués n'ont pas été
lus pour préparer cette fiche. Les regarder pour corriger les règles serait
régler le détecteur sur le jeu de mesure.

## Refaire le calcul

```bash
cd gateway && npm run bench -- ../data/jeu-factures/test.jsonl --json
```

Relancer la commande sur les mêmes règles redonne les mêmes chiffres : le
détecteur est déterministe. Ce n'est pas une seconde mesure.
