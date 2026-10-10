# 05. Rapport d'incident et réactions automatiques

Interface entre Loris (service de réponse), Nicolas (playbook, livrables) et
Joseph (dashboard). Statuts : voir [README.md](README.md).

## 1. Règles héritées du playbook

Toutes FAIT (PLAYBOOK, « Règles »).

- L'alerte montre les faits bruts, jamais la justification rédigée par un agent.
- Aucune action automatique ne déplace de fonds. Les actions automatiques ne font que bloquer.
- Une pause se lève uniquement par un humain habilité.
- Sans réponse humaine dans le délai fixé, une demande en attente est refusée.
- L'outil prépare le dossier. Il ne classe pas l'incident et ne notifie aucune autorité.

## 2. Champs du rapport

Schéma : [schemas/incident-report.schema.json](schemas/incident-report.schema.json).
La colonne de gauche reprend PLAYBOOK, « Contenu du rapport d'incident » : FAIT.
Le nom et le type des champs sont PROPOSÉS.

| Contenu demandé par le playbook | Champs |
|---|---|
| Identifiant de l'incident | `incident_id`, `report_version`, `generated_at_ms`, `trigger`, `request_ids` |
| Horodatages de détection, de pause et d'alerte | `timestamps` : `received_at_ms`, `detected_at_ms`, `observed_at_ms`, `paused_at_ms`, `alerted_at_ms` |
| Agent d'origine et chaîne d'autorité de la demande | `authority_chain` : `agent_id`, `agent_mandate`, `client_id`, `client_signer`, `request_digest`, `relay_tx_hash` |
| Codes raison et score | `detector` : `score`, `threshold`, `reason_codes` |
| Décision du contrat et motif | `contract` : `decision`, `reason`, `tx_hash`, `block_number`, `block_timestamp` ; `null` si la demande n'a pas atteint le contrat |
| Montant exposé et montant effectivement sorti | `amounts` : `exposed_wei`, `out_wei` |
| Actions automatiques exécutées | `automatic_actions` : `action`, `at_ms`, `journal_seq` |
| Décision humaine et son auteur | `human_decision` : `decision`, `author_role`, `author_id`, `at_ms`, `journal_seq` ; `null` tant que personne n'a qualifié |
| Empreinte du journal au moment du rapport | `journal_head` : `seq`, `hash` |

Précisions, PROPOSÉES :

- `trigger` reprend les quatre déclencheurs du playbook, `DETECTOR_SCORE`, `SCHEMA_REJECTED`, `CONTRACT_REFUSAL`, `RATE_BURST`, plus `REPEATED_REFUSALS` pour la répétition du § 4.
- `request_ids` : la première est la demande déclenchante. Un incident de répétition liste toutes les demandes comptées.
- `authority_chain` s'arrête là où la demande s'est arrêtée : `client_signer`, `request_digest` et `relay_tx_hash` valent `null` si la demande n'a jamais été signée ou soumise.
- `exposed_wei` est le montant **inscrit** au contrat pour la référence visée. Il vaut `null` si la référence est inconnue du contrat : c'est le scénario 4. Le montant écrit dans le document piégé n'apparaît nulle part : c'est une affirmation de l'attaquant, pas un fait.
- `out_wei` est la somme des événements `Paid` des demandes de l'incident. Il vaut `"0"` dans tous les scénarios d'attaque.
- `contract.reason` est le code numérique. Le libellé se lit dans [02-contrat.md](02-contrat.md) § 7.
- Aucun champ libre : ni commentaire, ni justification. Le schéma rejette tout champ supplémentaire.
- Le rapport ne porte ni classification réglementaire ni décision de notification : elles restent humaines et hors de l'outil.
- Un rapport se régénère : après une décision humaine, un nouveau rapport est produit, avec `human_decision` renseigné et une nouvelle empreinte de tête. Chaque génération écrit une entrée `INCIDENT_REPORT_GENERATED`.
- `journal_head` désigne la dernière entrée du journal **avant** l'entrée `INCIDENT_REPORT_GENERATED` de ce rapport.
- Règle hors schéma, rejouée par `make specs` : `paused_at_ms` et `alerted_at_ms` ne précèdent pas `detected_at_ms`.

Le playbook parle d'une « décision signée » pour la qualification humaine.
Le rapport porte ici l'auteur et le rang de l'entrée de journal, pas une signature
cryptographique. À renforcer si le temps le permet. PROPOSÉ.

## 3. Motif → réaction automatique

Quatre réactions, toutes bloquantes ou informatives.

| Réaction | Ce qu'elle fait |
|---|---|
| Journal | Entrée de journal, rien d'autre |
| Quarantaine | La demande et son document sont gelés hors de tout contexte de modèle, pour analyse. Seul un humain les libère |
| Pause de l'agent | L'agent ne peut plus rien faire passer : refus à la porte d'entrée, au relais et au contrat. Point b |
| Alerte | Envoi des faits bruts à l'analyste sécurité et au trésorier (PLAYBOOK, étape 3) |

Une ligne avec pause de l'agent ouvre un incident et produit un rapport.

### Porte d'entrée

| Code | Journal | Quarantaine | Pause de l'agent | Alerte | Statut |
|---|---|---|---|---|---|
| `INSTRUCTION_IN_DATA`, verdict `BLOCK` | oui | oui | oui | oui | FAIT (Scénarios, 3) |
| `AUTHORITY_VIOLATION`, verdict `BLOCK` | oui | oui | oui | oui | FAIT (PROPOSITION § 3, étape 3 bis) |
| `PAYMENT_ANOMALY`, verdict `BLOCK` | oui | oui | oui | oui | FAIT (§ 3, étape 3 bis) |
| `SCHEMA_INVALID` | oui | oui | oui | oui | FAIT (§ 3, étape 3 bis) |
| `RATE_LIMITED` | oui | non | oui | oui | FAIT (PLAYBOOK, « Déclencheurs ») ; pas de quarantaine PROPOSÉ : le contenu n'a pas été lu |
| `TOKEN_INVALID` | oui | non | **non** | à la répétition, § 4 | FAIT (Scénarios, 2) |
| Signal sous le seuil, verdict `PASS` | oui | non | non | non | PROPOSÉ |

`TOKEN_INVALID` ne met jamais un agent en pause : personne n'est authentifié.
Sinon, n'importe qui pourrait faire suspendre un agent en usurpant son
identifiant.

### Contrat

Lu par le service de réponse dans l'indexeur. Le contrat ne notifie personne :
point d.

| Motif | Journal | Quarantaine | Pause de l'agent | Alerte | Statut |
|---|---|---|---|---|---|
| 1 `INVOICE_UNKNOWN` | oui | oui | oui | oui | FAIT (Scénarios, 4) |
| 16 `PLACEMENT_UNKNOWN` | oui | oui | oui | oui | PROPOSÉ, par symétrie |
| 9 `AGENT_NOT_AUTHORIZED` | oui | oui | oui | oui | PROPOSÉ |
| 15 `ACTION_UNKNOWN` | oui | oui | oui | oui | PROPOSÉ |
| 4 `SIGNATURE_INVALID` | oui | non | **non** | oui | PROPOSÉ : l'agent n'est pas authentifié ; la file ou le relais est suspect |
| 14 `VALIDITY_WINDOW_INVALID` | oui | non | non | oui | PROPOSÉ : la file et le relais auraient dû l'arrêter |
| Code inconnu | oui | non | non | oui | PROPOSÉ : traité comme un refus |
| 2 `INVOICE_ALREADY_PAID`, 3 `REQUEST_REPLAYED` | oui | non | à la répétition | à la répétition | FAIT (Scénarios, 8) |
| 6 `EXCEEDS_PLACEABLE` | oui | non | à la répétition | à la répétition | FAIT (Scénarios, 7) |
| 5 `REQUEST_EXPIRED`, 17 `PLACEMENT_ALREADY_EXECUTED`, 18 `REF_PENDING_APPROVAL`, 19 `INSUFFICIENT_CASH` | oui | non | à la répétition | à la répétition | PROPOSÉ |
| 7 `VAULT_PAUSED`, 8 `AGENT_PAUSED` | oui | non | non | non | PROPOSÉ : la pause est déjà en place |
| 10 `ABOVE_THRESHOLD` | oui | non | non | notification à l'approbateur | FAIT (Scénarios, 6) |
| 11 `APPROVAL_TIMEOUT`, 12 `APPROVAL_REFUSED` | oui | non | non | notification à l'approbateur | PROPOSÉ |
| 0 `NONE`, 13 `APPROVED` | oui | non | non | non | FAIT (Scénarios, 1) |

Les motifs des quatre premières lignes sont dits **hostiles** : une demande
légitime ne les produit pas. Ceux marqués « à la répétition » sont dits
**bénins** : une erreur honnête les produit.

Le playbook cite « décision 0 du contrat » comme déclencheur, sans distinction.
Les scénarios 7 et 8 disent le contraire pour les refus bénins. Ce tableau suit
les scénarios. Point k.

### Disponibilité

| Situation | Réaction | Statut |
|---|---|---|
| Une demande reste en file plus de 15 s sans être soumise, ou expire en file | Journal (`QUEUE_EXPIRED` à l'expiration), alerte de disponibilité vers l'exploitation. Aucune pause, aucun incident de sécurité | FAIT (Scénarios, 5) ; 15 s PROPOSÉ |

## 4. Répétition

Les scénarios 2, 7 et 8 disent « répétition » sans chiffre. Valeurs PROPOSÉES,
point k.

| Paramètre | Valeur |
|---|---|
| `N` | 3 |
| `T` | 60 s, fenêtre glissante |

| Compteur | Clé | À la N-ième occurrence dans T |
|---|---|---|
| Refus bénins du contrat | `agent_id` authentifié, tous motifs bénins confondus | Incident `REPEATED_REFUSALS` : pause de l'agent, alerte, rapport. Pas de quarantaine |
| `TOKEN_INVALID` | global, toutes sources confondues | Alerte `REPETITION`. Ni pause, ni incident |

Un seul couple `N` et `T` pour les deux compteurs : deux chiffres à retenir et à
tester. Les deux premiers refus bénins ne déclenchent rien d'autre que le journal.

La fenêtre est mesurée sur l'horodatage du bloc pour les refus du contrat, et
sur `received_at_ms` pour les jetons invalides.

## 5. Ordre et délais

Ordre des actions d'un incident, PROPOSÉ : quarantaine, pause hors chaîne, alerte,
rapport. La pause sur la chaîne est demandée en même temps que la pause hors
chaîne et se confirme plus tard.

Les trois délais affichés (PROPOSITION § 2) :

| Délai | Calcul |
|---|---|
| Arrivée → détection | `detected_at_ms − received_at_ms` |
| Détection → pause | `paused_at_ms − detected_at_ms` |
| Détection → alerte | `alerted_at_ms − detected_at_ms` |

| Champ | Détection par la porte d'entrée | Détection par le contrat |
|---|---|---|
| `detected_at_ms` | `detected_at_ms` de la sortie de la porte | Horodatage du bloc de la décision, en millisecondes |
| `observed_at_ms` | `null` | Heure à laquelle le service de réponse a lu l'événement |
| `paused_at_ms` | Heure de la pause hors chaîne | idem |

Pour une détection par le contrat, les délais partent de l'horodatage du bloc.
Ils incluent donc l'attente de l'indexeur et de l'écoute, et leur précision est
celle de l'horloge de la chaîne, en secondes. C'est à dire tel quel sur la fiche
de défense, à côté des valeurs mesurées. Point d.

`paused_at_ms` est l'heure de la pause hors chaîne : c'est elle qui arrête
l'agent en premier. L'heure de confirmation sur la chaîne se lit dans l'entrée
`AGENT_PAUSED` de `scope` `ONCHAIN`.

## 6. Cohérence avec les scénarios

| Scénario | Ce que dit la page « Scénarios » | Ce que donne ce document |
|---|---|---|
| 2 | « Entrée de journal. Une répétition déclenche une alerte. » | `TOKEN_INVALID` : journal ; 3 en 60 s : alerte, sans pause |
| 3 | « Quarantaine de la demande, pause de l'agent d'origine, alerte avec les faits bruts, rapport d'incident. » | `INSTRUCTION_IN_DATA` : les quatre |
| 4 | « Le refus on-chain déclenche la même réponse qu'au scénario 3. » | `INVOICE_UNKNOWN` : les quatre |
| 7 | « Refus journalisé. Pas d'incident, sauf répétition. » | `EXCEEDS_PLACEABLE` : journal ; 3 en 60 s : incident |
| 8 | « Refus journalisé. Une répétition met l'agent en pause. » | `REQUEST_REPLAYED`, `INVOICE_ALREADY_PAID` : journal ; 3 en 60 s : pause |

## 7. Exemples

| Fichier | Issue attendue |
|---|---|
| [valid/01-scenario-3-porte-entree.json](examples/incident/valid/01-scenario-3-porte-entree.json) | Valide : `contract` à `null` |
| [valid/02-scenario-4-refus-du-contrat.json](examples/incident/valid/02-scenario-4-refus-du-contrat.json) | Valide : cohérent avec [chaine-valide.jsonl](examples/journal/chaine-valide.jsonl), tête à l'entrée 10 |
| [valid/03-qualifie-par-un-humain.json](examples/incident/valid/03-qualifie-par-un-humain.json) | Valide : rapport régénéré après qualification |
| [invalid/01-sans-empreinte-du-journal.json](examples/incident/invalid/01-sans-empreinte-du-journal.json) | Rejet par le schéma |
| [invalid/02-montant-en-nombre.json](examples/incident/invalid/02-montant-en-nombre.json) | Rejet par le schéma : montant en nombre JSON |
| [invalid/03-pause-avant-detection.json](examples/incident/invalid/03-pause-avant-detection.json) | Schéma valide ; règle `TIME_ORDER` |
| [invalid/04-justification-de-l-agent.json](examples/incident/invalid/04-justification-de-l-agent.json) | Rejet par le schéma : champ libre |
