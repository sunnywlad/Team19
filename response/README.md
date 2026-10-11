# response/ : journal chaîné, réactions automatiques, rapports d'incident

Implémentation de [specs/04-journal.md](../specs/04-journal.md) et de
[specs/05-incident.md](../specs/05-incident.md), dans un seul service :

- le **journal** : écrivain unique du fichier chaîné, et script de vérification ;
- la **réponse** : quarantaine, pause de l'agent, alerte, rapport d'incident ;
- la **lecture** dont le dashboard a besoin (`dashboard/API-NEEDS.md`, § 2 à 5).

Le service ne tient aucune clé et aucune de ses actions ne déplace de fonds.

## Lancer le service

```bash
npm ci --ignore-scripts
```

```bash
npm start
```

| Variable | Défaut | Sens |
|---|---|---|
| `JOURNAL_FILE` | `var/journal.jsonl` | Fichier du journal, une entrée JSON par ligne |
| `JOURNAL_PORT` | `8790` | Port d'écoute sur `127.0.0.1` |
| `RELAY_API_URL` | `http://127.0.0.1:8787` | API en lecture du relais : décisions du contrat et file |
| `RESPONSE_AGENTS_FILE` | `specs/examples/fixtures.json` | Agents et mandats, pour la chaîne d'autorité des rapports |
| `QUARANTINE_DIR` | `../gateway/var/quarantine` | Documents gelés par la porte d'entrée, lus pour l'extrait |
| `RESPONSE_DATA_DIR` | `var/` | Rapports d'incident, dans `incidents/` |
| `DEMO_MODE` | absent | `1` ouvre `POST /demo/reset` |

Aucune de ces variables n'est un secret.

## Écrire une entrée

`POST /journal/entries`, corps de 64 Ko au plus. Le composant remet `type`,
`component`, `request_id`, `agent_id`, `client_id` et `data`. Le service attribue
`v`, `seq`, `ts_ms`, `prev_hash` et `hash` : un appelant qui les fournit est rejeté.

| Réponse | Sens |
|---|---|
| `201` `{ seq, hash, duplicate: false }` | Entrée écrite et synchronisée sur le disque |
| `200` `{ seq, hash, duplicate: true }` | Déjà écrite avec cette clé d'idempotence |
| `400` `{ error: "INVALID_ENTRY", error_count }` | Non conforme au schéma gelé. Le contenu reçu n'est jamais renvoyé |
| `409` `{ error: "IDEMPOTENCY_CONFLICT" }` | Clé déjà utilisée pour une autre entrée |
| `413` | Corps trop volumineux |

### Idempotence

En-tête `Idempotency-Key`, fourni par l'appelant, 200 caractères au plus. Il n'est
pas écrit dans le journal. `type + ":" + request_id` suffit pour un type écrit une
fois par demande. Les types qui se répètent pour une même demande
(`DECISION_OBSERVED`, `AGENT_PAUSED`, `ALERT_SENT`, `SCHEMA_REJECTED`,
`INCIDENT_REPORT_GENERATED`) demandent une clé plus précise.

### Journal avant action

Avant une action qui ne se rattrape pas, par exemple soumettre au contrat :
`GET /journal/head`. Pas de réponse, pas d'action.

## Lire

| Route | Réponse |
|---|---|
| `GET /journal/head` | `{ count, seq, hash }`, l'empreinte de tête |
| `GET /journal/entries?from_seq=n&limit=m` | `{ entries, head }` à partir d'un rang, 1000 entrées au plus. Forme lue par la porte d'entrée |
| `GET /journal/entries?limit=m` | Tableau des `m` dernières entrées, 500 au plus. Forme lue par le dashboard |
| `GET /journal/verification` | Tête courante et résultat de la vérification, relancée à chaque appel |
| `GET /incidents` | `[{ report, quarantine_excerpt }]` : toutes les générations de rapports |
| `GET /agents/paused` | Pauses en vigueur, une ligne par niveau |
| `GET /health` | `{ ok, entries, demo_mode }` |

`request_id=0x…` filtre les deux formes de `/journal/entries`.

La vérification compare le fichier à la tête que le service garde en mémoire :
une troncature ou une réécriture faite pendant qu'il tourne sort en
`HEAD_MISMATCH`. Après un redémarrage, cette référence est relue dans le fichier :
seule une tête conservée ailleurs (rapport, dashboard) protège alors.

`quarantine_excerpt` est le début du document gelé, 200 caractères au plus. C'est
un contenu hostile : il n'est jamais interprété, ni écrit dans le journal, ni mis
dans une alerte. Il vaut `null` quand la porte avait laissé passer la demande.

## Réactions automatiques

Table de specs/05 § 3. Ordre d'un incident : quarantaine, pause hors chaîne,
alerte, rapport.

| Source | Événement | Réaction |
|---|---|---|
| Porte d'entrée | Détecteur `BLOCK`, schéma rejeté | Incident : quarantaine, pause, alerte, rapport |
| Porte d'entrée | Débit dépassé | Incident sans quarantaine : le contenu n'a pas été lu |
| Porte d'entrée | Jeton invalide | Journal seul. Trois en 60 s : alerte `REPETITION`, jamais de pause |
| Contrat | Motifs hostiles 1, 9, 15, 16 | Incident complet dès la première fois |
| Contrat | Motifs bénins 2, 3, 5, 6, 17, 18, 19 | Journal seul. Trois en 60 s pour un même agent : incident sans quarantaine |
| Contrat | 4, 14, ou code inconnu | Alerte à l'analyste, sans pause |
| Contrat | 10, 11, 12 | Notification à l'approbateur |
| Contrat | 0, 7, 8, 13 | Rien de plus que le journal |
| File du relais | Demande en attente depuis plus de 15 s, ou expirée | Alerte `AVAILABILITY` vers l'exploitation, une fois par demande |
| Journal | `ENQUEUED` depuis plus de 15 s, sans `SUBMITTED`, `QUEUE_EXPIRED` ni `SCHEMA_REJECTED` de la file ou du relais | La même alerte, sous la même clé : une fois par demande, relais arrêté ou non |

Les blocages de la porte sont lus dans le journal, au moment où la porte les
écrit. Les décisions du contrat sont lues dans l'indexeur du relais, chaque
seconde, et recopiées dans le journal (`DECISION_OBSERVED`). La file est lue
toutes les 5 secondes, dans le relais et dans le journal : l'alerte de
disponibilité ne dépend pas d'un relais en marche.

Une alerte porte des faits bruts : identifiants, codes raison, motif du contrat.
Elle s'affiche sur la sortie du service, et l'entrée `ALERT_SENT` en garde la trace.

## Décision humaine

```bash
npm run human -- ATTACK_CONFIRMED --author 0x… --incident 0x… --agent 0x…
```

```bash
npm run human -- AGENT_RESUMED --author 0x… --agent 0x…
```

Décisions : `FALSE_POSITIVE`, `ATTACK_CONFIRMED`, `AGENT_RESUMED`, `TOKEN_REVOKED`,
`VAULT_PAUSED`, `VAULT_RESUMED`. `--role` vaut `ANALYST` (défaut), `OWNER` ou
`APPROVER`. `AGENT_RESUMED` est le seul moyen de lever une pause. Une décision
rattachée à un incident régénère son rapport, avec l'auteur.

## Remise à zéro entre deux passages de démo

```bash
DEMO_MODE=1 npm run demo:reset
```

La commande demande au service d'archiver le journal et les rapports, puis de
repartir d'une chaîne neuve, et à la porte d'entrée de réémettre les jetons.

- Rien n'est effacé. Le journal devient `journal.jsonl.<horodatage>.bak`, sa tête
  est écrite dans `journal.jsonl.<horodatage>.bak.head.json`, et les rapports
  passent dans `incidents.<horodatage>.bak/`. L'archive se vérifie encore :
  `npm run verify-journal -- <archive> --expect-head <tête>`.
- La route `POST /demo/reset` n'existe que si le service a été lancé avec
  `DEMO_MODE=1`. En dehors d'une démo, aucun appel ne peut vider le journal.
- Les pauses et les incidents repartent de zéro avec la chaîne.

## Rapport d'incident

Prérempli depuis le journal, validé contre le schéma gelé avant d'être publié,
écrit dans `var/incidents/`. Son empreinte (`report_sha256`) est le SHA-256 de sa
forme canonique. Les tests rejouent le scénario 4 de `specs/examples/` : le
service écrit les entrées 7 à 11 de `chaine-valide.jsonl` à l'octet près et
produit le rapport `02-scenario-4-refus-du-contrat.json` à l'identique.

La décision portée par le rapport est la dernière observée pour la demande, en
ignorant les refus de rejeu (motif 3) : rejouer une demande ne masque pas ce que
le contrat avait décidé.

## Depuis TypeScript

```ts
import { HttpJournalClient } from "../../response/src/client.ts";

const journal = new HttpJournalClient("http://127.0.0.1:8790");
await journal.append({ type: "ENQUEUED", component: "QUEUE", request_id, agent_id, client_id, data: { expires_at } });
```

`append()` a la forme de l'interface `JournalClient` de `relay/`. Il lève
`JournalUnavailableError` si le service ne répond pas et `JournalRejectedError`
si l'entrée est refusée.

## Vérifier un journal

```bash
npm run verify-journal -- var/journal.jsonl
```

```bash
npm run verify-journal -- var/journal.jsonl --expect-head <empreinte> --expect-seq <n>
```

| Code | Sens |
|---|---|
| 0 | Chaîne intègre, et tête conforme si elle était demandée |
| 1 | Chaîne rompue : `SEQ_MISMATCH`, `PREV_MISMATCH` ou `HASH_MISMATCH` |
| 2 | Fichier illisible ou entrée non conforme au schéma : `FORMAT` |
| 3 | Chaîne intègre, mais tête différente de celle attendue : `HEAD_MISMATCH` |
| 64 | Erreur d'usage |

Les tests rejouent les six chaînes de `specs/examples/journal/`, et le service
réécrit `chaine-valide.jsonl` à l'octet près.

## Garanties et limites

- Un seul écrivain : un fichier verrou empêche deux services d'écrire le même journal.
- Une entrée est sur le disque avant que le service réponde `201`.
- Le service refuse de démarrer sur un journal altéré.
- Sans tête de référence, une troncature en fin de chaîne ou une réécriture
  complète passent inaperçues : il faut `--expect-head` (specs/04 § 6).
- Aucune authentification entre composants : quiconque atteint le port peut
  ajouter une entrée. Le service n'écoute que sur `127.0.0.1`.
- Le journal prouve l'intégrité de ce qui a été écrit, pas sa vérité.

- La pause sur la chaîne (`AGENT_PAUSED`, niveau `ONCHAIN`) n'est pas posée : le
  service ne tient pas de clé et le contrat n'est pas déployé. Seule la pause
  hors chaîne existe, appliquée par la porte d'entrée.
- `amounts.exposed_wei` vaut toujours `null` : le service ne lit pas les
  registres du contrat. `out_wei` vaut `"0"`, un incident naissant toujours d'un
  blocage ou d'un refus.
- Les compteurs de répétition sont en mémoire : un redémarrage les remet à zéro.
  Les pauses et les rapports, eux, sont retrouvés.
- Si le relais ne répond pas, les refus du contrat ne déclenchent plus de
  réponse. C'est signalé sur la sortie du service.
- Une alerte n'est envoyée à personne : elle est affichée et journalisée.

## Écart relevé avec la spec

specs/04 § 5 annonce `HASH_MISMATCH` quand `seq` est renuméroté pour masquer un
trou. Avec l'ordre gelé des contrôles, c'est `PREV_MISMATCH` qui sort en premier,
puisque l'entrée déplacée pointe encore vers l'empreinte retirée. `HASH_MISMATCH`
n'apparaît que si `prev_hash` est recollé lui aussi. L'altération est détectée
dans les deux cas ; seule la phrase de la spec est à préciser.
