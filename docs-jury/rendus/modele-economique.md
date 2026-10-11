# Modèle économique

Ce document décrit le circuit du jeton VETO : qui l'achète, qui le gagne, qui le
perd. Il sépare ce que le dépôt prouve de ce qui reste une hypothèse. Aucun prix
et aucun chiffre de marché n'y figurent : nous n'en avons pas.

## En une phrase

Deux revenus, pour deux offres. Un abonnement par coffre protégé finance la
passerelle et le coffre. La vente de VETO finance la vérification : le client
achète des VETO pour faire juger les décisions de ses agents, et le contrat de
récompenses les reverse, avec une émission, aux agents vérificateurs qui
rendent un verdict valide.

## Les acteurs

| Acteur | Rôle | Ce qu'il paie | Ce qu'il reçoit |
|---|---|---|---|
| Client | Entreprise qui confie des paiements à des agents IA | Des VETO, achetés en monnaie fiduciaire | Un verdict 0, 1 ou 2 sur chaque décision soumise |
| Opérateur du guichet | Vend les VETO et admet les clients | Le coût d'exploitation du guichet | Le prix de vente des VETO |
| Agent vérificateur | Juge une demande, par engagement puis révélation | Une caution en VETO, immobilisée | Une part des frais et une émission par verdict valide |
| Validateur du L1 | Produit les blocs et applique les règles d'émission | Le coût du nœud | Rien dans la démo : voir « Questions ouvertes » |
| Trésor | Adresse fixée au déploiement | | Les cautions saisies et les restes de division |

## Le circuit du jeton

**1. Achat, en monnaie fiduciaire pour le moment.** Le client règle hors chaîne.
L'opérateur du guichet crédite alors des VETO à son adresse. Une référence de
paiement ne se crédite qu'une fois. Le contrat ne vérifie pas le règlement
bancaire : l'opérateur l'atteste (`src/VetoDesk.sol`).

**2. Dépense.** Chaque demande de vérification coûte des frais en VETO, payés à
la création (`src/VerificationMarket.sol`).

**3. Rémunération.** À la clôture, les frais sont partagés à parts égales entre
les vérificateurs dont la révélation est valide. Chacun retire sa part lui-même.
Le reste de la division va au trésor (`src/Rewards.sol`).

**4. Émission.** Le contrat de récompenses frappe en plus un bonus en VETO pour
chaque révélation valide, par le précompilé Native Minter du L1. L'administrateur
du L1 a accordé ce droit de frappe à deux contrats seulement : les récompenses
et le guichet.

**5. Discipline.** Un vérificateur dépose une caution pour entrer au tirage.
Trois fautes prouvables sur la chaîne la réduisent : absence, 1 % ; engagement
sans révélation valide, 5 % ; vote contredit par un prédicat, 20 %. Les saisies
vont au trésor. Trois fautes excluent du tirage pour dix demandes
(`src/Slashing.sol`, `docs-jury/fautes.md`). Un simple désaccord avec la
majorité ne coûte rien.

## Les paramètres de la démo

| Paramètre | Valeur | Source |
|---|---|---|
| Frais d'une demande | 1 VETO | `script/deploy-all.sh`, `FEE` |
| Taille du comité | 3 vérificateurs, tirés au sort | `src/DrawnVerificationMarket.sol` |
| Bonus frappé par révélation valide | 1 VETO | `script/deploy-all.sh`, `BONUS` |
| Caution minimale | 100 VETO | `script/deploy-all.sh`, `MIN_STAKE` |
| Saisies | 1 %, 5 %, 20 % | `src/Slashing.sol` |

## La règle d'émission

**Les frais d'une demande valent au moins ce que le contrat de récompenses émet pour elle.**

```
frais ≥ bonus × taille du comité
```

Les paramètres de la démo ne la respectent pas : 1 VETO de frais pour 3 VETO
émis. Deux réglages la respectent, à comité de trois.

| Réglage | Frais | Bonus par révélation | Payé par le client | Émis | Reçu par les vérificateurs |
|---|---:|---:|---:|---:|---:|
| Démo actuelle | 1 | 1 | 1 | 3 | 4 |
| Frais relevés | 3 | 1 | 3 | 3 | 6 |
| Bonus réduit | 1 | 1/3 | 1 | 1 | 2 |

Le contrat n'applique pas cette règle. Les frais sont fixés au déploiement du
marché, le bonus au déploiement des récompenses, sans contrôle de l'un par
l'autre. La pile déployée sur le L1 de test porte encore les valeurs de la démo.

Ce que la règle garantit : l'émission ne dépasse jamais le volume des frais.
Ce qu'elle ne garantit pas : une masse de VETO stable. Les frais ne sont pas
détruits, ils passent aux vérificateurs. Chaque demande ajoute donc toujours
son bonus à la masse en circulation.

## D'où vient le revenu

| Source | Mécanisme | État |
|---|---|---|
| Vente de VETO | Le client paie en monnaie fiduciaire, le guichet crédite | Contrat écrit et testé, déployé sur le L1 de test. Le crédit n'a pas été joué en scène. Aucun encaissement réel |
| Trésor | Cautions saisies et restes de division | Saisies de 1 % et 20 % montrées sur le L1 (`docs-jury/preuves/scene-aws.md`). Montants marginaux |
| Abonnement par coffre protégé | Prix fixe par coffre, pour la passerelle, la réponse à l'incident et le coffre | Hypothèse. Aucune facturation construite, aucun prix fixé |

Les deux revenus se complètent. L'abonnement paie un service continu, la
passerelle et le coffre. La vente de VETO paie un service à l'usage, le
verdict d'un comité. Les deux offres restent à relier : le verdict du marché
n'entre pas encore dans la décision du coffre.

## Ce qui est construit, ce qui est une hypothèse

| Élément | État |
|---|---|
| Guichet d'émission contre paiement hors chaîne | Écrit et testé (`src/VetoDesk.sol`), déployé sur le L1 de test |
| Frais par demande, partage entre révélations valides, retrait par le bénéficiaire | Écrit, testé, joué de bout en bout sur le L1 de test (`docs-jury/preuves/e2e-aws.md`) |
| Émission d'un bonus par révélation valide | Écrit et testé (`src/Rewards.sol`) |
| Caution, saisies, exclusion | Écrit, testé, joué sur le L1 de test |
| Prix du VETO en monnaie fiduciaire | Non fixé |
| Encaissement réel, facturation, rapprochement bancaire | Non construit |
| Achat de VETO sur la chaîne, par un actif numérique | Non construit. Le L1 n'a ni pont ni messagerie applicative vers une autre chaîne |
| Conversion des VETO d'un vérificateur en monnaie fiduciaire | Non construit, non conçu |

## Questions ouvertes

1. **La sortie des vérificateurs.** Un vérificateur gagne des VETO, mais rien ne
   lui permet de les convertir. Tant que ce rachat n'existe pas, le VETO ne
   rémunère personne en dehors du réseau.
2. **La masse de VETO.** La règle d'émission borne le bonus par les frais, mais
   la masse croît à chaque demande et aucun plafond global n'existe. Si un
   vérificateur peut un jour revendre ses VETO au prix où le client les achète,
   le bonus n'est couvert par aucun encaissement. Deux pistes : détruire une
   part des frais, ou racheter les VETO sous leur prix de vente.
3. **La rémunération des validateurs.** Le gaz est payé en VETO, mais aucune
   mesure ne dit s'il couvre le coût d'un nœud. La démo tourne sur un seul
   validateur, exploité par nous.
4. **La confiance dans le guichet.** L'opérateur atteste seul le paiement, et
   l'administrateur du L1 accorde seul le droit de frappe. Il n'existe ni
   multisignature ni plafond : un administrateur compromis sort du modèle.
5. **Le statut du jeton.** Vendre un jeton contre de la monnaie fiduciaire pose
   la question de sa qualification au regard du règlement MiCA. Elle n'a pas été
   étudiée : elle se pose à un juriste avant toute vente.
6. **Le prix.** Il doit couvrir le coût réel d'un verdict, donc trois appels à
   des modèles de langage. Ce coût n'est pas mesuré.
