# Plan du deck

Huit slides, le maximum admis. Pitch du tour 1 : 5 minutes puis 2 minutes de
questions. Finale : 3 minutes, en gardant les slides 1, 3, 4, 5 et 8.

Règles de ce plan : aucun chiffre qui ne sorte de la
[fiche de défense](../../docs-jury/rendus/fiche-defense-mesures.md), et chacun avec sa condition ; une
ligne qu'elle affiche encore « à mesurer », la slide la dit « à mesurer » aussi. Les formules écartées sont dans
[questions-reponses.md](../pitch/questions-reponses.md).

Les slides 2 et 7 (cible, modèle économique) ne s'appuient sur aucune source du
dépôt ni du kit : ce sont des **hypothèses à valider par Nicolas**, écrites sans
chiffre de marché.

## 1. Problème

**Texte.** Un agent IA lit une facture piégée. Il ordonne un paiement. Personne
n'a vérifié qui avait le droit de demander quoi.

**Notes orales.** Partir de la facture, pas de la technologie. Un agent à faible
privilège reçoit un document ; le document contient une instruction ; l'agent
financier exécute. Le défaut n'est pas le modèle qui se trompe, c'est l'absence
de contrôle entre celui qui lit et celui qui paie.

## 2. Cible

**Texte.** Hypothèse : les équipes de trésorerie qui confient des paiements à
des agents IA, et leurs responsables sécurité.

**Notes orales.** Qui a le problème aujourd'hui : une direction financière qui
automatise le traitement des factures, et le responsable sécurité à qui on
demande de signer. Ne citer ni taille de marché ni nom de client : nous n'en
avons pas. Dire que la cible reste à valider.

## 3. Solution

**Texte.** Une passerelle de confiance. Chaque demande est testée. Une règle
vérifiable décide. Une attaque déclenche une réponse, sans jamais déplacer de
fonds.

**Notes orales.** Trois idées. Un : l'agent ne fournit que des identifiants, le
montant et le bénéficiaire sont ceux déjà inscrits. Deux : deux filets, un
détecteur à l'entrée, une règle de paiement derrière. Trois : la réponse est
automatique mais ne fait que bloquer ; lever une pause est un geste humain.
Dire que nous n'empêchons pas l'injection : nous en bornons les conséquences.
Cadrage du paiement ([README](../../README.md)) : sur réseau de test local
(anvil), le contrat paie avec des fonds de test ; en production, `Paid` serait
l'autorisation qu'un connecteur bancaire consommerait : envisagé, non construit.

## 4. Comment ça marche

**Texte.** Le schéma du [README](../../README.md) : dix composants, douze étapes,
de l'agent au dashboard. En couleur : ce qui tourne, contrat compris, avec la
mention « réseau de test local ». En gris : ce qui n'est pas construit, la pause
sur la chaîne et le connecteur bancaire.

**Notes orales.** Suivre une demande : porte d'entrée, IA du client, file,
relais, contrat, indexeur, dashboard. Le document ne dépasse jamais la porte.
Être net sur l'état : le contrat existe, il décide et paie sur un réseau de
test local (anvil), pas ailleurs. Le mode par défaut de la démo reste un faux
coffre qui rejoue ses règles en mémoire : dire lequel des deux est à l'écran.

## 5. Démo

**Texte.** Trois factures : une piégée et détectée, une piégée et manquée, une
légitime qui passe.

**Notes orales.** La vidéo ou la scène en direct, selon
[script-video.md](../demo/script-video.md). Insister sur la deuxième : c'est
le cas que notre détecteur rate, et nous le montrons exprès. Finir sur la
facture légitime. Délais d'attente en secondes. Repli : la vidéo.

## 6. Ce que nous avons mesuré, et nos limites

**Texte.** Le tableau de la fiche de défense, tel quel, avec ses cases « à
mesurer ». En tête : 50 attaques détectées sur 100, 4 demandes légitimes
bloquées sur 100, sur un jeu synthétique de 200 échantillons, une attaque pour
une légitime. En dessous : données synthétiques, contrat déployé sur un réseau
de test local seulement, pas d'audit indépendant.

**Notes orales.** Lire les deux chiffres avec leur condition : jeu de test
synthétique de 200 échantillons, une attaque pour une légitime, mesuré le
10 octobre 2026. Dire la réserve : en production les attaques sont rares, et
la majorité des blocages seraient des demandes légitimes. Par famille : la
mieux tenue est `hors-mandat`, 8 sur 8 ; les plus faibles sont
`doublon-facture`, 1 sur 8, et `fausse-autorite`, 2 sur 8. Nommer un cas
manqué : `t-003`, une facture présentée en double, que la porte laisse passer.
Les lignes encore « à mesurer » se disent telles quelles : règles fixes de
référence et délais. Les lignes du contrat se lisent comme la fiche les
affiche le jour du pitch, avec leur réserve, sans rien y ajouter. Ne citer
aucun chiffre du jeu provisoire.

## 7. Conformité et modèle économique

**Texte.** À gauche, le tableau de [conformite.md](../../docs-jury/rendus/conformite.md) : ce que
l'outil apporte, ce qu'on ne revendique pas. À droite, hypothèse : un
abonnement par coffre protégé.

**Notes orales.** Conformité : nous ne revendiquons rien ; nous apportons un
journal vérifiable, un rapport prérempli et des horodatages. Un auditeur
vérifie une décision en cinq étapes sans nous faire confiance. Modèle
économique : une hypothèse, pas un plan validé ; aucun prix, aucun revenu
annoncé.

## 8. Équipe

**Texte.** Wladimir : contrat. Loris : porte d'entrée et réponse. Joseph :
relais, dashboard, CI, livrables. Nicolas : pitch et relecture.

**Notes orales.** Une phrase par personne. Finir sur ce qui reste à faire, dans
l'ordre : poser la pause d'un agent sur la chaîne, remplir les lignes encore
« à mesurer », sortir du réseau de test local.
