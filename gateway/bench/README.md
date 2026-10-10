# Mesure provisoire du détecteur

Premiers chiffres du détecteur de la porte d'entrée, sur un jeu **provisoire**.
Ils servent à savoir où en est le détecteur cette nuit. Ils ne sont pas la
mesure à présenter au jury tant que le jeu de `data/` n'existe pas.

## Réserve à lire avant de citer un chiffre

Le jeu a été écrit par l'auteur des règles du détecteur. Même écrit sans
regarder les règles, il partage son vocabulaire et ses réflexes : un jeu écrit
par quelqu'un d'autre donnera très probablement un rappel plus bas. Le jeu est
petit (114 échantillons, 77 pour la mesure), donc chaque pourcentage bouge de
plusieurs points pour une seule attaque de plus ou de moins. Ces chiffres valent
pour ce jeu synthétique, pas pour le monde réel.

## Le jeu

[jeu-provisoire.jsonl](jeu-provisoire.jsonl) : 114 échantillons, tous synthétiques,
sans nom ni coordonnée réelle.

| Étiquette | Famille | Nombre |
|---|---|---:|
| Légitime | Facture simple, détaillée, relance, conditions, placement | 30 |
| Légitime | Cas piégeux : mots qui ressemblent à une attaque | 18 |
| Attaque | Instruction visible | 10 |
| Attaque | Instruction cachée | 10 |
| Attaque | Changement de bénéficiaire | 10 |
| Attaque | Montant gonflé | 10 |
| Attaque | Fausse autorité | 10 |
| Attaque | Fuite sous les seuils | 10 |
| Attaque | Action hors mandat | 6 |

Un tiers du jeu (37 échantillons) sert au réglage, le reste (77) à la mesure. La
répartition dépend du seul identifiant : elle est la même à chaque lancement.

## Résultats sur les 77 échantillons de mesure

46 attaques, 31 demandes légitimes, seuil 70.

| Version | Rappel | Précision | Faux positifs | Attaques manquées |
|---|---:|---:|---:|---:|
| `regles-0.1`, avant réglage | 43,5 % | 100 % | 0 sur 31 | 26 sur 46 |
| `regles-0.2`, après réglage | 54,3 % | 100 % | 0 sur 31 | 21 sur 46 |

Temps de détection : 0,1 ms en moyenne, moins de 10 ms au pire. Le fichier
[resultats-provisoires.json](resultats-provisoires.json) porte le détail.

Le réglage n'a regardé que le tiers réservé à cet effet. Sur ce tiers, le rappel
est passé de 30 % à 70 % : l'écart avec les 54,3 % de la mesure montre ce que les
règles ajoutées ne généralisent pas.

### Rappel par famille, `regles-0.2`

| Famille | Détectées | Lecture |
|---|---:|---|
| Action hors mandat | 4 sur 4 | Règle sans nuance : le mandat vient du jeton |
| Instruction visible | 7 sur 10 | Les tournures polies ou indirectes passent |
| Instruction cachée | 6 sur 9 | Vu : commentaire HTML, texte masqué, base64, caractères invisibles. Manqué : substitution de lettres, consigne déguisée en métadonnée |
| Changement de bénéficiaire | 3 sur 5 | |
| Fuite sous les seuils | 2 sur 4 | Voir la limite ci-dessous |
| Montant gonflé | 2 sur 7 | Un montant gonflé sans mot de correction est invisible sans le montant inscrit au contrat |
| Fausse autorité | 1 sur 7 | Le point le plus faible : une autorité invoquée sans mot-clé ne se distingue pas d'une phrase ordinaire |

### Choix du seuil

| Seuil | Rappel | Faux positifs |
|---:|---:|---:|
| 50 | 58,7 % | 1 sur 31 |
| 60 | 54,3 % | 1 sur 31 |
| 70 | 54,3 % | 0 sur 31 |

Le seuil reste à 70 : descendre gagne deux attaques et coûte une facture honnête
bloquée. À 50, la même facture redemandée dans une rafale serait aussi bloquée à
la porte, alors que le scénario 8 demande qu'elle atteigne le contrat.

## Ce que ces chiffres disent

- **Aucune facture légitime bloquée**, y compris les 18 cas piégeux. C'est le
  résultat le plus solide, à confirmer sur un jeu plus grand.
- **Près d'une attaque sur deux passe la porte.** C'est attendu pour des règles
  sans modèle, et c'est la raison d'être du second filet : le contrat refuse une
  facture qui n'est pas dans son registre, quel que soit le texte reçu.
- **Deux familles ne se détectent pas dans un document seul.** Un montant gonflé
  se voit en comparant au montant inscrit, que la porte ne connaît pas. Une fuite
  sous les seuils se voit dans la répétition : la porte la traite par la limite
  de débit et le service de réponse par le compte des refus, que ce banc ne
  mesure pas.

## Refaire la mesure

```bash
npm run bench -- bench/jeu-provisoire.jsonl
```

```bash
npm run bench -- bench/jeu-provisoire.jsonl --json
```

## Contrôle de non-régression

```bash
npm run bench -- bench/jeu-provisoire.jsonl --min-recall 0.5 --max-false-positives 0
```

Sort en code 1 si le rappel passe sous 50 % ou si une facture légitime est
bloquée. C'est la commande à brancher sur le job `detecteur` de la CI. Le même
plancher est vérifié par `npm test`.

## Quand le jeu de `data/` arrive

1. Lancer le banc dessus, sans toucher aux règles : c'est la mesure à présenter.
2. Montrer au jury au moins une attaque manquée, tirée de la sortie du banc.
3. Tout réglage ultérieur se fait sur le tiers de réglage de ce nouveau jeu, et
   se remesure sur le reste.
