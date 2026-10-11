# Playbook de réponse : demande de paiement piégée

Livrable du track 1. Il répond à quatre questions : qui est alerté, quelles
actions sont automatiques, lesquelles restent humaines, comment c'est documenté.
La colonne « État dans le dépôt » dit ce que le code fait aujourd'hui, pas ce
que la conception prévoit.

Légende : **implémenté** (code et tests dans le dépôt), **partiel** (une partie
manque, dite sur la ligne), **humain** (geste d'une personne, outillé ou non),
**non fait**.

## Déclencheurs

| Déclencheur | Source | État dans le dépôt |
|---|---|---|
| Score du détecteur au-dessus du seuil | Porte d'entrée, étape 2 | Implémenté : `gateway/src/detector.ts`, seuil 70, borne incluse |
| Demande rejetée par le schéma | Porte d'entrée, étape 3 | Implémenté : `gateway/schemas/inbound.schema.json` |
| Rafale de demandes d'un même agent | Limite de débit | Implémenté : `gateway/src/ratelimit.ts`, 5 demandes sur 10 s. Incident sans quarantaine : le contenu n'a pas été lu |
| Décision `0` du contrat | Événement lu dans l'indexeur du relais | Partiel : `response/src/relay-watch.ts` lit les décisions, mais aucun contrat n'est déployé. Rejoué en test sur un faux coffre |

Une décision `0` ne déclenche pas toujours tout le playbook. Les motifs
hostiles (facture ou placement inconnu, agent sans mandat, action inconnue)
ouvrent un incident dès la première fois. Les motifs bénins (rejeu, facture
déjà payée, placement trop élevé) ne laissent qu'une entrée de journal, puis
ouvrent un incident au troisième en 60 s pour un même agent
([specs/05-incident.md](../specs/05-incident.md) § 3 et § 4).

## Les sept étapes

| # | Étape | Automatique ou humain | Qui | Trace | État dans le dépôt |
|---|---|---|---|---|---|
| 1 | Détection : score, codes raison, horodatage | Automatique | Porte d'entrée ou contrat | Entrée de journal `DETECTION` ou `DECISION_OBSERVED` | **Implémenté** pour la porte. **Partiel** pour le contrat : pas de contrat déployé |
| 2 | Confinement : la demande est mise en quarantaine, l'agent d'origine est mis en pause | Automatique | Service de réponse | `QUARANTINED`, `AGENT_PAUSED` | **Partiel**. Quarantaine et pause hors chaîne faites : la porte refuse l'agent (`gateway/src/pauses.ts`), le relais écarte ses demandes (`relay/src/pauses.ts`). La pause sur la chaîne n'est pas posée |
| 3 | Alerte : faits bruts (demande, agent, codes raison, motif du contrat) | Automatique | Service de réponse → analyste sécurité et trésorier | `ALERT_SENT` | **Partiel**. L'alerte est affichée sur la sortie du service et journalisée, avec ses destinataires en rôles. Elle n'est envoyée à personne |
| 4 | Qualification : attaque réelle ou faux positif | Humain | Analyste sécurité | `HUMAN_DECISION` | **Humain**, outillé : commande `human` de `response/`. L'auteur est déclaré, pas authentifié ; la décision n'est pas signée |
| 5 | Décision : lever la pause, révoquer le jeton de l'agent, ou mettre le coffre en pause | Humain | Analyste, puis propriétaire pour la reprise | `HUMAN_DECISION` | **Humain**, outillé pour la levée de pause et la révocation du jeton, que la porte applique. **Non fait** pour le coffre : la décision est journalisée, aucun contrat ne la reçoit |
| 6 | Documentation : rapport d'incident prérempli depuis le journal. Classification et notification éventuelle | Rapport automatique, classification humaine | Responsable conformité | `INCIDENT_REPORT_GENERATED`, rapport et empreinte du journal | **Implémenté** pour le rapport (`response/src/report.ts`), régénéré après la qualification. Le montant exposé reste vide : le service ne lit pas les registres du contrat. Classification : **humain**, hors de l'outil |
| 7 | Retour d'expérience : le cas rejoint le jeu de mesure, le seuil est revu | Humain | Équipe sécurité | Version du jeu | **Humain**, sans outil. Le jeu de test ne se relance pas après retouche des règles : un cas nouveau entre dans une nouvelle version du jeu (`data/jeu-factures/README.md`) |

Par rapport au kit, l'alerte ne porte ni bénéficiaire ni montant inscrit : le
service de réponse ne lit pas les registres du contrat, et une facture inconnue
n'en a pas.

## Règles

- L'alerte montre les faits bruts, jamais la justification rédigée par un agent.
- Aucune action automatique ne déplace de fonds. Les actions automatiques ne font que bloquer.
- Une pause se lève uniquement par un humain habilité.
- Sans réponse humaine dans le délai fixé, une demande en attente est refusée.
- L'outil prépare le dossier. Il ne classe pas l'incident et ne notifie aucune autorité.

Ce que le dépôt montre pour chacune :

| Règle | Preuve | Réserve |
|---|---|---|
| Faits bruts | Test « alerte l'analyste et le trésorier avec des faits bruts », `response/test/engine.test.ts`. Le schéma du rapport rejette tout champ libre | L'extrait du document gelé est servi au dashboard, borné et jamais interprété ; il n'entre ni dans le journal ni dans l'alerte |
| Aucun déplacement de fonds | Test « n'écrit aucune action qui déplace des fonds ». Le service de réponse ne tient aucune clé | |
| Pause levée par un humain | Test « seule une décision humaine lève une pause ». Aucune route de la porte ne lève une pause | « Habilité » n'est pas vérifié : quiconque atteint le port local du journal peut consigner une décision |
| Délai dépassé vaut refus | En file : une demande expirée n'est jamais soumise (`relay/test/scenarios.test.ts`, scénario 5). Approbation : rejouée par le faux coffre (`relay/src/fake-vault.ts`) | Le délai d'approbation est une règle du contrat ([specs/02-contrat.md](../specs/02-contrat.md) § 6), qui n'est pas écrit |
| Ni classement ni notification | Le rapport n'a aucun champ pour cela | |

## Commandes humaines

Depuis `response/`, service lancé. Les identifiants sont ceux du rapport.

```bash
npm run human -- ATTACK_CONFIRMED --author <id> --incident <id> --agent <id>
```

```bash
npm run human -- AGENT_RESUMED --author <id> --agent <id>
```

Décisions admises : `FALSE_POSITIVE`, `ATTACK_CONFIRMED`, `AGENT_RESUMED`,
`TOKEN_REVOKED`, `VAULT_PAUSED`, `VAULT_RESUMED`. Rôle par `--role` : `ANALYST`
par défaut, `OWNER` ou `APPROVER`.

## Contenu du rapport d'incident

- Identifiant de l'incident, horodatages de détection, de pause et d'alerte
- Agent d'origine et chaîne d'autorité de la demande
- Codes raison et score
- Décision du contrat et motif
- Montant exposé et montant effectivement sorti
- Actions automatiques exécutées
- Décision humaine et son auteur
- Empreinte du journal au moment du rapport

Le vrai format est le schéma `specs/schemas/incident-report.schema.json`, décrit
champ par champ dans [specs/05-incident.md](../specs/05-incident.md) § 2. Trois
exemples valides sont dans `specs/examples/incident/valid/` : un blocage à la
porte d'entrée, un refus du contrat, un rapport régénéré après qualification.
Le service sert ses rapports sur `GET /incidents` (`response/README.md`).
