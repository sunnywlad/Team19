# Campagne locale vérifiable du 11 octobre 2026

Ce dossier apporte **une nouvelle campagne**, distincte du rapport historique
« trimestre, 500 attaques, 18 familles, 30,20 M€ ». Le simulateur et les entrées
de ce rapport historique n'ont pas été retrouvés : ses chiffres ne sont pas
reproduits ici. Les résultats de ce dossier ne valident pas ses volumes, sa part
d'automatisation, sa latence ou son scénario d'admission compromise.

## Rejouer depuis la racine

Node >= 22.18 et dépendances exactes du relais :

```sh
npm ci --ignore-scripts --prefix relay
node demo/campagne/campagne.ts nominal
node demo/campagne/campagne.ts aveugle
node --test demo/campagne/campagne.test.ts
```

Chaque mode écrit `resultats/<mode>.json` et `resultats/<mode>.jsonl`.
Les fichiers versionnés sont les sorties du run local du 11 octobre 2026.
Le journal contient chaque demande signée, les décisions et événements, les
empreintes de documents, les scores et les règles appliquées. Aucune clé privée
ni valeur d'environnement n'est lue ou écrite. Les clés de test sont éphémères,
déterminées par la graine publique et réservées à cette simulation sans fonds.

| Run vérifié | Bloquées par filtre | Refus du coffre | Paiements corrects issus des 500 attaques | Détournement / doublons |
|---|---:|---:|---:|---:|
| Nominal | 100 | 400 | 0 | 0 / 0 |
| Aveugle | 0 | 450 | 50 | 0 / 0 |

Les 100 paiements légitimes de référence sont supplémentaires. Total payé :
100 000 unités en nominal et 375 325 unités en aveugle, exclusivement aux
bénéficiaires admis. Les 50 paiements supplémentaires en aveugle représentent
275 325 unités au bon bénéficiaire et au bon montant.

## Conditions et entrées

Graine : `20261011`, horloge initiale `2026-10-11T09:00:00.000Z`. Les montants
utilisent des **unités comptables synthétiques**, aucune conversion en euros.
Caisse initiale 100 000 000, réserve 800 000, seuil humain 20 000. Chaque
montant de facture admise est inférieur au seuil. Les entrées sont générées
déterministement dans `campagne.ts`, et chaque demande est conservée dans JSONL.

Les dix familles ont chacune 50 tentatives : facture inconnue, document de
détournement sur facture admise, signature forgée, demande modifiée après
signature, demande expirée, rejeu, double paiement, agent sans mandat,
placement inconnu, placement excessif. Les tests de rejeu et de double paiement
précèdent chacun leur attaque d'un paiement légitime, soit 100 paiements
de référence par mode. Aucun paiement humain n'est approuvé.

Le mode nominal appelle le véritable `gateway/src/detector.ts` avec son seuil
inchangé. Le mode aveugle calcule le même score, puis **court-circuite seulement
son refus** pour éprouver le coffre quand aucune détection ne bloque l'entrée.
Ce n'est pas une mesure de rappel sur un jeu indépendant et ce n'est pas une
affirmation que ces documents sont indétectables.

Le signataire est `relay/src/signer.ts`, le coffre est exactement
`relay/src/fake-vault.ts`, sans changement de règles. Les empreintes SHA-256
des composants sont dans chaque rapport, base source `6fbb013`.

## Ce qui est vérifié

Le run échoue immédiatement si un événement `Paid` désigne un bénéficiaire ou
montant différent du registre indépendant des factures admises, une référence
inconnue, une référence déjà payée, ou si la caisse ne diminue pas exactement
du total des paiements. Toute attaque doit avoir une issue explicite.
Le test injecte aussi des traces falsifiées (destination, montant, référence
inconnue, duplication) et vérifie que ce contrôleur les refuse.

Une facture admise avec document hostile peut être payée au fournisseur admis
et au montant inscrit. Cette issue est comptée comme **paiement correct**, pas
comme détection ni refus. « Zéro détournement » ne veut donc pas dire
« zéro paiement déclenché par une demande hostile ».

## Limites

Appels directs en mémoire : pas de porte HTTP, authentification de jetons,
limite de débit, file, relais, réponse, pause automatique, rapport d'incident,
LLM, réseau, Solidity ou transaction blockchain. Le coffre simulé ne prouve
pas la parité avec Solidity ; en particulier le parcours d'approbation humaine
n'est pas exercé. Les familles sont choisies, répétées et connues du test,
sans prétention statistique ni couverture des attaques inconnues. La corruption
de l'admission, de l'approbateur et du propriétaire reste hors champ.

Les résultats doivent être cités ainsi : « Nouvelle campagne locale du
11 octobre : 500 tentatives sur dix familles, zéro unité détournée, composants
de détection/signature/coffre simulé. Les paiements corrects sont comptés à part.
Script, entrées et traces livrés. »
