# 00. À trancher à quatre

Tout ce qui suit est **PROPOSÉ**. Chaque point donne la recommandation par défaut
déjà appliquée dans les specs, et ce qui change si l'on décide autrement.
Statuts : voir [README.md](README.md).

## Vue d'ensemble

| Point | Question | Recommandation par défaut | Touche |
|---|---|---|---|
| a | Le contrat vérifie-t-il le mandat de l'agent ? | Oui : registre des agents sur la chaîne | 02 |
| b | Où s'applique la pause de l'agent, et avec quelle clé ? | Porte d'entrée, relais et contrat ; clé du gardien tenue par le service de réponse | 02, 04, 05 |
| c | Deux sens de « réserve » | Deux noms ; la facture bloquée reste une dette admise | 02 |
| d | Chemin des événements et délais mesurés | La réponse lit l'indexeur ; les délais incluent bloc et écoute, et on le dit | 05 |
| e | Motif du scénario 4 | `INVOICE_UNKNOWN` | acceptance |
| f | Scénario 7 | Deux placements préenregistrés | 02, acceptance |
| g | Heure du gel | 8h | planning |
| h | Qui vérifie le jeton de l'agent ? | La porte d'entrée | 03 |
| i | Objet reçu par la porte, et origine de `request_id` | Sixième interface ; `request_id` attribué à l'arrivée | 01, 03 |
| j | Le seuil `S` s'applique-t-il à `PLACE` ? | Oui | 02 |
| k | Seuil de répétition, et refus bénins | 3 en 60 s ; un refus bénin isolé ne déclenche rien | 05 |
| l | Ordre des contrôles de `submit` | Celui de 02 § 5 ; une signature invalide ne consomme pas l'identifiant | 02 |
| m | Rôles, inscriptions, retrait | Rôles figés au déploiement ; pas de retrait | 02 |
| n | Journal : écrivain, copie des décisions, ancrage | Écrivain unique ; `DECISION_OBSERVED` ; ancrage optionnel | 04 |
| o | Agents de la scène de démo | Un agent demandeur par scène | acceptance |
| p | Valeurs chiffrées | Tableau en fin de document | toutes |
| q | `make specs` dans la CI | Ajouter un job, hors de cette branche | CI |

## Les huit points demandés

### a. Le contrat doit-il vérifier le mandat de l'agent ?

Constat. `AUTHORITY_VIOLATION` n'est détecté qu'à la porte d'entrée
(PROPOSITION § 6). FICHE-DEFENSE annonce pourtant un « registre des agents, des
rôles et de leurs mandats », sans dire où il vit.

Recommandation : **oui**. Registre sur la chaîne, `registerAgent(agentId, mandate)`
par le propriétaire, motif `AGENT_NOT_AUTHORIZED` (code 9). Le scénario central
du projet est un agent à faible privilège qui obtient un paiement : la règle qui
l'interdit mérite d'être dans le seul composant qui paie, comme les autres.

Limite à dire : `agent_id` est affirmé par le client dans la demande signée. Le
contrat vérifie le mandat de l'agent **déclaré**, pas l'identité de l'agent réel.
Cela arrête une IA du client honnête mais trompée, pas un client malveillant.

Si non : le code 9 reste réservé et inutilisé, les lignes 7 de 02 § 5 et
`registerAgent` disparaissent. La pause de l'agent sur la chaîne (point b) demande
de toute façon un état par agent.

### b. Où est appliquée la pause de l'agent, et quelle clé la pose ?

Constat. Trois sources se contredisent :

- PLAYBOOK, étape 2 : la pause de l'agent est **automatique**, faite par le service de réponse.
- Composants, tableau : « Réponse : aucune clé ».
- PROPOSITION § 4 : seul le gardien met en pause ; Composants place la clé du gardien chez l'humain.

Recommandation : trois points d'application, deux niveaux.

| Niveau | Où | Posée par | Clé | Délai |
|---|---|---|---|---|
| Hors chaîne | Porte d'entrée et relais refusent l'agent | Service de réponse | Aucune | Immédiat : c'est `paused_at_ms` |
| Sur la chaîne | Le contrat répond `AGENT_PAUSED` | Service de réponse | Clé du gardien | Un bloc, plus la confirmation |

La clé du gardien passe donc au service de réponse. C'est le rôle prévu pour
cela : il ne peut que bloquer, ni reprendre ni payer. Si cette clé fuit, le pire
est un blocage, que le propriétaire lève. Elle ne porte que du gaz.

À corriger dans les livrables si c'est validé : « Réponse : clé du gardien, pause
seule » et « Humain : clés d'approbateur et de propriétaire ».

Reste ouvert : la pause du **coffre** est une décision humaine (PLAYBOOK, étape
5), mais seule la clé du gardien la pose. Par défaut, l'analyste la demande au
service de réponse par une commande journalisée (`HUMAN_DECISION`, `VAULT_PAUSED`).

Si l'on tient à « Réponse : aucune clé » : la pause automatique reste hors
chaîne, et la pause sur la chaîne devient un geste humain. Le contrat ne refuse
alors plus seul un agent suspendu qui contournerait le relais ; or seul le
relais peut soumettre, donc le risque résiduel est un relais compromis.

### c. Deux sens de « réserve »

Constat. « Réserve » désigne le paramètre du propriétaire dans la formule du
plaçable (PROPOSITION § 4), et « montant réservé » le montant bloqué du cas 1
(§ 3, § 4).

Recommandation : deux noms.

| Sens | Nom | Vue |
|---|---|---|
| Paramètre de la formule | Réserve de sécurité | `safetyReserve()` |
| Montant du cas 1 | Montant bloqué | `totalHeld()` |

La facture bloquée **reste dans les dettes admises** : elle n'est pas payée. Elle
est déjà déduite du plaçable depuis son inscription et ne l'est pas une seconde
fois. Conséquence : la phrase du scénario 6, « le montant réservé n'est plus
plaçable pendant l'attente », est vraie mais n'ajoute rien : le plaçable ne bouge
pas à l'entrée dans le cas 1.

Second garde-fou proposé : une facture ne se paie pas avec de l'argent bloqué
(`montant ≤ cash − totalHeld`, motif `INSUFFICIENT_CASH`).

### d. Chemin des événements

Constat. Le diagramme trace une flèche « 0 · refusé » du contrat vers la
réponse. Un contrat ne notifie personne.

Recommandation : contrat → événement → indexeur → service de réponse. Le service
de réponse écrit `DECISION_OBSERVED` dans le journal, puis réagit.

Conséquence sur les mesures : pour une attaque arrêtée par le contrat, les délais
« détection → pause » et « détection → alerte » partent de l'horodatage du bloc.
Ils incluent le temps de bloc, l'attente de l'indexeur et l'écoute, et leur
précision est celle de l'horloge de la chaîne. La fiche de défense doit le dire à
côté du chiffre, et donner séparément les délais des attaques arrêtées à la porte
d'entrée. Les deux ne sont pas comparables.

Dépendance à noter : si l'indexeur tombe, aucune décision n'est faussée, mais la
réponse automatique aux refus du contrat s'arrête. À surveiller comme le relais.

### e. Scénario 4 : le vrai motif

Constat. Le tableau de la page « Scénarios » et PROPOSITION § 2 disent
« bénéficiaire hors registre ». La demande ne porte que des identifiants
(PROPOSITION § 5) : elle ne peut pas désigner un bénéficiaire. Le détail du même
scénario dit juste : « la demande ne correspond à aucune facture inscrite ».

Recommandation : motif `INVOICE_UNKNOWN`. À corriger dans le tableau, la
proposition, le pitch et la vidéo. Dire « bénéficiaire hors registre » au jury
exposerait à une question à laquelle le contrat ne répond pas.

### f. Scénario 7 : « 30 demandés, 20 plaçables »

Constat. Une demande `PLACE` ne porte pas de montant : elle vise une « action
préenregistrée » (PROPOSITION § 5).

Recommandation : deux placements préenregistrés par l'admission, `P-030` et
`P-020`, à usage unique, vers un bénéficiaire inscrit. D'où `registerPlacement`
et les motifs `PLACEMENT_UNKNOWN` et `PLACEMENT_ALREADY_EXECUTED`.

### g. Gel des fonctionnalités

Constat. Dimanche 8h (PLANNING § 5), dimanche 9h (CHECKLIST, « Gel »).

Recommandation : **8h**. Le planning place les mesures finales, la fiche de
défense et la vidéo entre 8h et 10h : un gel à 9h leur retire une heure sur deux.
Corriger la checklist.

### h. Qui vérifie le jeton de l'agent ?

Constat. PROPOSITION § 3 et § 7 nomment un composant « Entrée ». Il n'existe ni
dans le diagramme ni dans le tableau de la page « Composants », ni dans les
branches de PLANNING § 2.

Recommandation : la **porte d'entrée** (`gateway/`, Loris) tient les étapes 1 à
3. D'où `TOKEN_INVALID` et `RATE_LIMITED` dans la liste des codes raison. Le
jeton est contrôlé avant toute lecture du contenu.

## Points ajoutés pendant la rédaction

### i. Ce que la porte reçoit, et d'où vient `request_id`

Constat. PROPOSITION § 5 décrit un format signé par le client et ajoute « rejet
à l'étape 3 ». Or la signature n'existe qu'à l'étape 6. Il y a donc deux objets :
celui que l'agent envoie (étapes 1 à 3), que rien ne décrit, et la demande signée
(étapes 6 à 9).

Recommandation :

- Reconnaître une sixième interface, minimale, entre les agents scriptés et la porte : [03-detecteur.md](03-detecteur.md) § 2, schéma [schemas/inbound.schema.json](schemas/inbound.schema.json) (amendement du 10/10). Sans elle, Joseph et Loris ne peuvent pas se brancher.
- `request_id` est attribué par la porte à l'arrivée et recopié dans la demande signée : un seul identifiant de l'arrivée à la décision.
- Le schéma strict de la demande signée s'applique à la mise en file et avant la soumission.

### j. Le seuil `S` s'applique-t-il aux placements ?

Constat. « Au-dessus du seuil S, la décision est 1 » (PROPOSITION § 4), sans
distinction. Le scénario 6 ne montre qu'une facture.

Recommandation : oui, aux deux actions. Coût : un placement bloqué n'est pas une
dette, d'où la vue `heldPlacements()` et un terme de plus dans le plaçable.

Si non : `heldPlacements` vaut toujours 0 et disparaît. C'est la coupe la plus
simple côté contrat.

### k. Répétition, et refus bénins

Constat. Les scénarios 2, 7 et 8 disent « répétition » sans chiffre. PLAYBOOK
fait de toute « décision 0 » un déclencheur ; les scénarios 7 et 8 disent
« journal seul, sauf répétition ».

Recommandation : **3 occurrences en 60 s**. Les motifs du contrat sont classés
hostiles (réponse complète dès la première fois) ou bénins (journal seul, puis
incident à la troisième) : [05-incident.md](05-incident.md) § 3 et § 4. Le
playbook est à préciser dans ce sens.

À valider aussi : `SCHEMA_INVALID` met l'agent en pause dès la première fois
(PROPOSITION § 3, étape 3 bis). C'est sévère pour un agent seulement bogué.

### l. Ordre des contrôles de `submit`

Recommandation : l'ordre de [02-contrat.md](02-contrat.md) § 5, gelé, parce qu'il
fixe le motif quand plusieurs s'appliquent et que les tests en dépendent. Deux
choix à valider : une signature invalide ne consomme pas `request_id` ; toute
demande authentifiée le consomme, même refusée.

### m. Rôles, inscriptions, retrait

Recommandation :

- Cinq adresses distinctes, fixées au déploiement, sans rotation.
- Agents inscrits par le propriétaire ; placements inscrits par l'admission.
- Bénéficiaire non modifiable après inscription.
- Aucune fonction de retrait.
- Après refus ou expiration d'un cas 1, la facture redevient due.
- `expire` ouverte à tous ; `cancelInvoice` pour l'admission, première fonction à couper.

### n. Journal

Recommandation :

- Un seul service écrit le journal.
- `DECISION_OBSERVED` recopie les décisions du contrat dans le journal, pour que le rapport soit bien « prérempli depuis le journal ».
- L'empreinte de tête figure dans chaque rapport et sur le dashboard. L'ancrage sur la chaîne est optionnel, dans un contrat séparé du coffre, et premier à couper.
- La phrase de CONFORMITE sur la vérification est à nuancer : [04-journal.md](04-journal.md) § 6.

### o. Agents de la scène de démo

Constat. La scène joue les scénarios 3, 4 puis 1. Le scénario 3 met l'agent en
pause : avec un seul agent, les deux suivants s'arrêtent à la porte d'entrée.

Recommandation : trois agents demandeurs, un par scène. Sinon, lever la pause
entre deux scènes, ce qui demande un geste humain pendant la démo.

### p. Valeurs chiffrées

| Paramètre | Valeur | Où |
|---|---|---|
| Durée de vie maximale d'une demande | 300 s | 01 § 4 |
| Tolérance d'horloge sur `issued_at` | 60 s | 01 § 4 |
| Durée de vie d'une demande en démo | de l'ordre de 30 s | 01 § 4 |
| Délai d'approbation en démo | 30 s ; bornes de 10 s à 7 jours | 02 § 6 |
| Seuil `S` du monde de test | 25, pour 100 en caisse | acceptance |
| Seuil initial du détecteur | 70 sur 100, borne incluse | 03 § 4 |
| Limite de débit | 5 demandes par agent sur 10 s | 03 § 5 |
| Répétition | 3 en 60 s | 05 § 4 |
| Alerte de disponibilité | 15 s en file | 05 § 3 |
| `chainId` de Fuji | 43113, à vérifier par `eth_chainId` | 01 § 5 |

### q. `make specs` et la CI

Constat. La cible `specs` est branchée sur `make check`, mais
`.github/workflows/ci.yml` rejoue les scripts un par un et n'appelle pas
`make check`. La validation des exemples ne tourne donc qu'en local. Le job
`dependances` audite déjà `specs/package.json`.

Recommandation : ajouter un job `specs` au workflow, dans une branche qui a le
droit de toucher `.github/`.

Cette branche a modifié un fichier hors de `specs/` : le `Makefile`, pour y
ajouter la cible. C'était la condition pour brancher le contrôle.

## Contradictions entre les sources

| # | Sources | Contradiction | Point |
|---|---|---|---|
| 1 | PROPOSITION § 5 contre § 3 | « Rejet à l'étape 3 » d'un format qui n'est signé qu'à l'étape 6 | i |
| 2 | Scénarios, tableau, et PROPOSITION § 2, contre le détail du scénario 4 et PROPOSITION § 5 | « Bénéficiaire hors registre » contre « aucune facture inscrite » | e |
| 3 | PLAYBOOK étape 2 contre Composants contre PROPOSITION § 4 | Pause automatique, « Réponse : aucune clé », pause réservée au gardien | b |
| 4 | PLANNING § 5 contre CHECKLIST | Gel à 8h ou à 9h | g |
| 5 | PROPOSITION § 3 et § 7 contre Composants et PLANNING § 2 | Composant « Entrée » absent du diagramme, du tableau et des branches | h |
| 6 | PROPOSITION § 3 contre Composants | Étapes 5, 11 et 12 « Journal : Non », contre « chaque étape numérotée écrit une entrée dans le journal » | n |
| 7 | PLAYBOOK, « Déclencheurs », contre Scénarios 7 et 8 | Toute décision 0 déclenche, contre « pas d'incident, sauf répétition » | k |
| 8 | PROPOSITION § 4 | « Réserve » pour deux choses | c |
| 9 | Scénarios 7 contre PROPOSITION § 5 | Un montant « demandé » alors que la demande n'en porte pas | f |
| 10 | Scénarios, note sur la démo, contre le scénario 3 | L'agent mis en pause doit rejouer deux scènes | o |
| 11 | CONFORMITE, étape 4, contre la nature d'une chaîne d'empreintes | « Aucune entrée modifiée ou retirée » : faux pour les dernières entrées sans tête de référence | n |
| 12 | PLAYBOOK, étape 3, contre le scénario 4 | L'alerte montre « bénéficiaire, montant inscrit » : il n'y en a pas pour une facture inconnue | 05 § 2 |
| 13 | Composants, diagramme | Flèche du contrat vers la réponse : un contrat ne notifie pas | d |
| 14 | FICHE-DEFENSE contre PROPOSITION § 6 | « Registre des agents et de leurs mandats » annoncé, jamais situé | a |
| 15 | PROPOSITION § 4 contre PLAYBOOK étape 5 | La pause du coffre est une décision de l'analyste, mais seule la clé du gardien la pose | b |

## À vérifier avant de citer

Aucun article ni numéro de version de référentiel n'est cité dans `specs/`. Les
identifiants OWASP, NIST et MITRE de FICHE-DEFENSE, et les références DORA, AI
Act, MiCA de CONFORMITE, n'ont pas été vérifiés ici : ils restent « à vérifier »
par Nicolas avant toute citation, comme CONFORMITE le demande déjà pour DORA.
