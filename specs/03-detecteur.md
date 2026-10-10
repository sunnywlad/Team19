# 03. Sortie de la porte d'entrée

Interface entre Loris (porte d'entrée, réponse), Joseph (dashboard, agents
scriptés) et Nicolas (jeu de test, métriques). Statuts : voir [README.md](README.md).

## 1. Périmètre

La porte d'entrée produit **un** enregistrement par demande reçue, une fois les
étapes 1 à 3 terminées ou interrompues. Il est lu par le service de réponse, par
le banc de mesure et par le dashboard.

| Étape | Contrôle | Code en cas d'arrêt | Statut |
|---|---|---|---|
| 1 | Jeton de l'agent : court, révocable | `TOKEN_INVALID` | FAIT (PROPOSITION § 3 et § 7) |
| 1 | Limite de débit par agent | `RATE_LIMITED` | FAIT (§ 7) |
| 2 | Détecteur : trois signaux, un score | `INSTRUCTION_IN_DATA`, `AUTHORITY_VIOLATION`, `PAYMENT_ANOMALY` | FAIT (§ 6) |
| 3 | Parsing vers un JSON au schéma strict | `SCHEMA_INVALID` | FAIT (§ 3) |

PROPOSITION § 3 attribue l'étape 1 à un composant « Entrée » qui n'existe ni dans
le diagramme ni dans le tableau de la page « Composants ». Ici, la porte d'entrée
tient les trois étapes : un seul service, un seul enregistrement de sortie.
PROPOSÉ, point h.

## 2. Ce que la porte reçoit

Aucune source ne décrit l'objet envoyé par l'agent demandeur à l'étape 1. C'est
une sixième interface, entre les agents scriptés (Joseph) et la porte d'entrée
(Loris). Proposition minimale, PROPOSÉE, point i. Elle n'a pas de schéma versionné
tant qu'elle n'est pas validée.

| Élément | Où | Contenu |
|---|---|---|
| Jeton | En-tête d'autorisation | Jeton de l'agent. Jamais journalisé, jamais placé dans le contexte d'un modèle (FAIT, § 7) |
| `agent_id` | Corps | Identifiant déclaré. Doit être celui du jeton, sinon `TOKEN_INVALID` |
| `client_id` | Corps | Client visé |
| `action` | Corps | `PAY_INVOICE` ou `PLACE` |
| `ref_id` | Corps | Facture ou placement visé |
| `document` | Corps | Texte de la pièce transmise, borné en taille. C'est une donnée, jamais une instruction (FAIT, § 7) |

La porte attribue `request_id` à l'arrivée, y compris aux demandes qu'elle
rejette. Le mandat de l'agent (lecteur, demandeur) vient du registre de la porte,
indexé par le jeton, jamais du corps de la demande. PROPOSÉ.

## 3. Champs de la sortie

Schéma : [schemas/detector-output.schema.json](schemas/detector-output.schema.json).
Schéma strict : un champ inconnu, manquant ou mal typé est un défaut du producteur.

| Champ | Type | Sens | Statut |
|---|---|---|---|
| `request_id` | identifiant opaque | Attribué à l'arrivée | PROPOSÉ |
| `agent_id` | identifiant opaque ou `null` | Agent authentifié. `null` si le jeton est invalide | PROPOSÉ |
| `score` | entier de 0 à 100, ou `null` | Score du détecteur. `null` seulement si le détecteur n'a pas tourné | FAIT (§ 3) pour le score, échelle PROPOSÉE |
| `threshold` | entier de 0 à 100 | Seuil en vigueur au moment de la détection | PROPOSÉ |
| `verdict` | `PASS` ou `BLOCK` | Issue | PROPOSÉ |
| `reason_codes` | liste sans doublon | Codes de la liste fermée du § 5 | FAIT (§ 6) pour les trois signaux |
| `received_at_ms` | millisecondes Unix | Arrivée de la demande | PROPOSÉ |
| `detected_at_ms` | millisecondes Unix | Fin du traitement par la porte | PROPOSÉ |
| `detector_version` | chaîne courte | Version des règles ou du modèle, pour rattacher une mesure à ce qui l'a produite | PROPOSÉ |

Les horodatages sont en millisecondes : le délai « arrivée → détection » est une
des trois mesures affichées (PROPOSITION § 2), et il vaudrait presque toujours
zéro en secondes.

## 4. Règles

| Règle | Portée par | Statut |
|---|---|---|
| `BLOCK` porte au moins un code | Schéma | PROPOSÉ |
| `PASS` ne porte que des signaux du détecteur (les trois premiers codes), restés sous le seuil | Schéma | PROPOSÉ |
| `SCHEMA_INVALID`, `TOKEN_INVALID` et `RATE_LIMITED` donnent toujours `BLOCK` | Schéma | FAIT (§ 3, étape 3 bis ; Scénarios, 2) |
| `TOKEN_INVALID` ou `RATE_LIMITED` : c'est le seul code, et `score` vaut `null`. Le contenu n'est ni analysé ni transmis | Schéma | FAIT (Scénarios, 2) |
| `TOKEN_INVALID` : `agent_id` vaut `null` | Schéma | PROPOSÉ |
| `score ≥ threshold` donne `BLOCK` | `make specs` | FAIT (PLAYBOOK, « Déclencheurs »), borne incluse PROPOSÉE |
| `detected_at_ms ≥ received_at_ms` | `make specs` | PROPOSÉ |

Valeur initiale du seuil : 70. PROPOSÉ. Elle se règle sur le tiers du jeu réservé
au réglage (PROPOSITION § 6), puis ne bouge plus pendant la mesure.

Un `score` à `null` ne compte pas dans le rappel et la précision du détecteur :
le détecteur n'a rien vu. PROPOSÉ.

## 5. Codes raison

Liste fermée. On ajoute en fin de liste ; un consommateur qui reçoit un code
inconnu le traite comme `BLOCK`.

| Code | Origine | Sens | Statut |
|---|---|---|---|
| `INSTRUCTION_IN_DATA` | Détecteur | Instruction dans une donnée | FAIT (§ 6) |
| `AUTHORITY_VIOLATION` | Détecteur | Un agent demande ce que son mandat ne permet pas | FAIT (§ 6) |
| `PAYMENT_ANOMALY` | Détecteur | Nouveau bénéficiaire, montant gonflé, doublon, rafale | FAIT (§ 6) |
| `SCHEMA_INVALID` | Étape 3 | Champ inconnu, manquant ou mal typé | FAIT (§ 5) |
| `TOKEN_INVALID` | Étape 1 | Jeton absent, expiré, révoqué, inconnu, ou d'un autre agent | FAIT (Scénarios, 2) |
| `RATE_LIMITED` | Étape 1 | Limite de débit de l'agent dépassée | FAIT (§ 7 ; PLAYBOOK, « Déclencheurs ») |

Valeur initiale de la limite de débit : 5 demandes par agent sur 10 s. PROPOSÉ.

Ce que chaque code déclenche : [05-incident.md](05-incident.md) § 3.

## 6. Ce que l'agent demandeur voit

L'agent reçoit `request_id` et « acceptée » ou « rejetée ». Il ne reçoit ni le
score, ni les codes, ni le seuil : les renvoyer aiderait à formuler une attaque
qui passe sous le seuil. PROPOSÉ.

## 7. Exemples

| Fichier | Issue attendue |
|---|---|
| [valid/01-pass.json](examples/detector/valid/01-pass.json) | Valide : scénario 1 |
| [valid/02-block-instruction.json](examples/detector/valid/02-block-instruction.json) | Valide : scénario 3 |
| [valid/03-jeton-invalide.json](examples/detector/valid/03-jeton-invalide.json) | Valide : scénario 2, score et agent à `null` |
| [valid/04-schema-rejete.json](examples/detector/valid/04-schema-rejete.json) | Valide : score bas, rejet à l'étape 3 |
| [invalid/01-code-inconnu.json](examples/detector/invalid/01-code-inconnu.json) | Rejet par le schéma : code hors liste |
| [invalid/02-score-hors-borne.json](examples/detector/invalid/02-score-hors-borne.json) | Rejet par le schéma : 101 |
| [invalid/03-block-sans-code.json](examples/detector/invalid/03-block-sans-code.json) | Rejet par le schéma |
| [invalid/04-pass-au-dessus-du-seuil.json](examples/detector/invalid/04-pass-au-dessus-du-seuil.json) | Schéma valide ; règle `SCORE_VERDICT` |
| [invalid/05-jeton-invalide-avec-agent.json](examples/detector/invalid/05-jeton-invalide-avec-agent.json) | Rejet par le schéma |

## 8. Limites

- Un `PASS` ne dit pas que la demande est saine : le scénario 4 est un `PASS` sur une attaque. Au moins un cas manqué est montré au jury. FAIT (§ 6).
- `AUTHORITY_VIOLATION` n'est détecté ici que si le registre de la porte connaît le mandat de l'agent. Le contrat peut le revérifier : point a.
