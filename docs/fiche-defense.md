# Fiche de défense : Argent Intelligent

Secure Horizons, track 1 « Fintech Security ». Une page. Chaque fait renvoie au
fichier qui le montre ; ce qui n'existe pas est écrit comme tel.

## Scénario de menace

Un agent à faible privilège reçoit une facture piégée. Le document contient une
instruction qui ordonne un paiement vers un bénéficiaire contrôlé par
l'attaquant. Sans contrôle de la chaîne d'autorité, l'agent financier exécute.

## Fonctions NIST CSF 2.0 couvertes

| Fonction | Ce que fait le projet | Où |
|---|---|---|
| Identify | Registre des agents et de leur mandat, tenu par la porte d'entrée : un jeton court par agent. Le registre sur la chaîne prévu par la spec n'est pas implémenté | `gateway/src/tokens.ts`, [specs/02-contrat.md](../specs/02-contrat.md) § 3 |
| Detect | Détecteur à règles, trois signaux, à chaque demande. Décisions du contrat : interface gelée, rejouée par un faux coffre | `gateway/src/detector.ts`, `relay/src/fake-vault.ts` |
| Respond | Quarantaine, pause de l'agent hors chaîne, alerte affichée et journalisée, rapport d'incident, playbook | `response/src/engine.ts`, [playbook.md](playbook.md) |

## Risques visés

Liste reprise du kit. Les identifiants n'ont pas été relus à la source : à
vérifier avant toute citation ([specs/00-a-trancher.md](../specs/00-a-trancher.md), « À vérifier avant de citer »).

| Référentiel | Risques |
|---|---|
| OWASP agentique 2026 | ASI01, ASI02, ASI03, ASI07, ASI08, ASI09, ASI10 |
| OWASP LLM 2025 | LLM01, LLM02, LLM05, LLM06, LLM09, LLM10 |
| OWASP Smart Contract 2026 | SC01, SC02, SC05, SC06, SC08 : sans objet tant que le contrat n'est pas écrit |
| MITRE ATLAS | Injection de prompt directe et indirecte (identifiant à relever sur atlas.mitre.org) |

## Métriques

Ce tableau est écrit par `docs/outils/remplir-fiche.mjs` à partir des fichiers de
[mesures/](mesures/README.md). Il ne se modifie pas à la main : `make docs` échoue
si une valeur ne sort pas d'un fichier de mesure.

<!-- metriques:debut -->
| Métrique | Valeur | Conditions |
|---|---|---|
| Taille du jeu de test | 100 légitimes / 100 attaques | Lu dans le MANIFEST du jeu ; jeu de réglage : 60 / 60 |
| Échantillons mesurés par le banc | à mesurer | Le banc écarte de lui-même un tiers du fichier qu'il reçoit |
| Taux de détection (rappel) | à mesurer | Sur le jeu de test |
| Précision | à mesurer | Sur le jeu de test, à 1 attaque pour 1 légitime |
| Faux positifs | à mesurer | Nombre et taux, sur le jeu de test |
| Mêmes mesures pour les règles fixes | à mesurer | Référence de comparaison |
| Temps de calcul du détecteur | à mesurer | Règles seules, hors réseau et hors journal |
| Attaques passées la porte d'entrée puis bloquées par le contrat | à mesurer | Demande un contrat déployé |
| Attaques ayant abouti à une sortie de fonds | à mesurer | Demande un contrat déployé |
| Délai de détection, arrivée → détection | à mesurer | Détection par la porte d'entrée |
| Délai de réponse, détection → pause | à mesurer | Détection par la porte d'entrée ; pause hors chaîne |
| Délai de réponse, détection → alerte | à mesurer | Détection par la porte d'entrée |
| Délai de réponse, détection → pause | à mesurer | Détection par le contrat : part de l'horodatage du bloc |
| Délai de réponse, détection → alerte | à mesurer | Détection par le contrat : part de l'horodatage du bloc |

Fichiers de mesure lus :

- `docs/mesures/bench-test.json` : absent
- `docs/mesures/bench-reference.json` : absent
- `docs/mesures/delais.json` : absent
- `docs/mesures/demo.json` : absent
<!-- metriques:fin -->

Les délais d'une détection par le contrat partent de l'horodatage du bloc : ils
incluent le temps de bloc, l'attente de l'indexeur et l'écoute, et ne se
comparent pas à ceux de la porte d'entrée ([specs/05-incident.md](../specs/05-incident.md) § 5).

## Cas manqués

<!-- cas-manques:debut -->
Aucune mesure enregistrée : cette section est vide. Elle se remplit avec le tableau de métriques, depuis le même fichier.
<!-- cas-manques:fin -->

Un cas manqué est connu sans mesure : le scénario 4 de
[specs/acceptance/scenarios.md](../specs/acceptance/scenarios.md), une attaque formulée pour passer sous le seuil.

## Limites

Du kit :

- Données synthétiques : les taux ne valent pas pour le monde réel.
- L'injection de prompt n'est pas empêchée, ses conséquences sont bornées.
- Le contrat ne vérifie pas la vérité d'une facture.
- Un propriétaire compromis sort du modèle.
- Seuls les fonds détenus par le contrat sont protégés.
- Démonstration sur réseau de test, sans audit indépendant.

Du dépôt :

- Le contrat de [specs/contract/IArgentVault.sol](../specs/contract/IArgentVault.sol) n'a pas d'implémentation : le relais tourne sur un faux coffre en mémoire, qui ne détient aucun fonds.
- La pause d'un agent est appliquée hors chaîne, par la porte d'entrée et par le relais. Aucune pause n'est posée sur la chaîne (`response/README.md`, « Garanties et limites »).
- Le jeu de mesure est synthétique et écrit par un modèle de langage, par un seul auteur (`data/jeu-factures/README.md`).
- 1 attaque pour 1 légitime est un choix de mesure, pas la fréquence réelle : la précision mesurée est plus flatteuse qu'en production.
- Les étiquettes du jeu n'ont pas été relues par un humain.
- L'action `PLACE` est peu représentée : 14 lignes sur 200 dans le jeu de test (`data/jeu-factures/MANIFEST.json`).
- Le jeu de test se lance une seule fois, règles figées. Toute retouche des règles après la mesure l'invalide.
- Le banc écarte un tiers du fichier qu'il reçoit (`gateway/src/bench.ts`) : la mesure porte sur moins de lignes que le jeu de test n'en compte. Le tableau donne le nombre réellement mesuré.
- Le journal est « au moins une fois » : une entrée peut apparaître deux fois, jamais zéro (`relay/README.md`, « Journal : boîte d'envoi »).
- Une alerte n'est envoyée à personne : elle est affichée et journalisée.
