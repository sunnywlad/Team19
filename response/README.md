# response/ : journal chaîné

Implémentation de [specs/04-journal.md](../specs/04-journal.md) : le service de
journal (écrivain unique) et le script de vérification. Les réactions
automatiques et le rapport d'incident (specs/05) arrivent dans la branche suivante.

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
| `GET /journal/entries?request_id=0x…&from_seq=n&limit=m` | `{ entries, head }`, 200 entrées par défaut, 1000 au plus |

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

## Écart relevé avec la spec

specs/04 § 5 annonce `HASH_MISMATCH` quand `seq` est renuméroté pour masquer un
trou. Avec l'ordre gelé des contrôles, c'est `PREV_MISMATCH` qui sort en premier,
puisque l'entrée déplacée pointe encore vers l'empreinte retirée. `HASH_MISMATCH`
n'apparaît que si `prev_hash` est recollé lui aussi. L'altération est détectée
dans les deux cas ; seule la phrase de la spec est à préciser.
