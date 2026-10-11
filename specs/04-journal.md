# 04. Journal chaîné

Interface entre Loris (journal, réponse, script de vérification) et Joseph
(relais, file, dashboard). Statuts : voir [README.md](README.md).

## 1. Principes

| Principe | Statut |
|---|---|
| Chaque entrée contient l'empreinte de la précédente. Un script vérifie la chaîne | FAIT (PROPOSITION § 7) |
| Le rapport d'incident est prérempli depuis le journal et porte son empreinte | FAIT (PLAYBOOK, étape 6 et « Contenu du rapport ») |
| Un seul écrivain : le service de journal. Lui seul attribue `seq`, `ts_ms`, `prev_hash` et `hash` | PROPOSÉ |
| Les autres composants lui remettent `type`, `component`, les trois identifiants et `data` | PROPOSÉ |
| Stockage : un fichier, une entrée JSON par ligne, dans l'ordre de `seq` | PROPOSÉ |
| Aucun jeton, aucune clé, aucun contenu de document, aucune donnée nominative : des identifiants et des empreintes | FAIT (§ 7), étendu au journal PROPOSÉ |

Un écrivain unique est nécessaire : une chaîne d'empreintes impose un ordre total,
que cinq composants écrivant chacun de leur côté ne peuvent pas garantir. Le
transport entre un composant et le service de journal reste au choix de Loris.

## 2. Champs d'une entrée

Schéma : [schemas/journal-entry.schema.json](schemas/journal-entry.schema.json).

| Champ | Type | Sens |
|---|---|---|
| `v` | `1` | Version du format |
| `seq` | entier à partir de 0 | Rang de l'entrée, sans trou |
| `ts_ms` | millisecondes Unix | Heure d'écriture par le service de journal |
| `type` | liste fermée, § 3 | Type d'événement |
| `component` | `GATEWAY`, `CLIENT_AI`, `QUEUE`, `RELAY`, `RESPONSE`, `HUMAN` | Composant à l'origine de l'entrée |
| `request_id` | identifiant opaque ou `null` | Demande concernée |
| `agent_id` | identifiant opaque ou `null` | Agent **authentifié**. `null` sinon |
| `client_id` | identifiant opaque ou `null` | Client |
| `data` | objet | Champs propres au type, tous obligatoires, aucun champ libre |
| `prev_hash` | empreinte SHA-256 | Empreinte de l'entrée précédente, ou valeur de départ |
| `hash` | empreinte SHA-256 | Empreinte de cette entrée, § 4 |

Tous les nombres sont des entiers. Un nombre à virgule est rejeté par le schéma.

L'heure d'un fait est portée par `data` quand elle diffère de l'heure d'écriture
(`received_at_ms`, `detected_at_ms`, `block_timestamp`). Les délais se calculent
sur ces champs, pas sur `ts_ms`.

## 3. Types d'événement

Liste fermée, alignée sur les étapes « Journal : Oui » de PROPOSITION § 3.

| Étape | Type | Composant | `data` | Statut |
|---|---|---|---|---|
| 1 | `REQUEST_RECEIVED` | `GATEWAY` | `received_at_ms`, `document_sha256` | FAIT (§ 3) |
| 1 | `AUTH_REJECTED` | `GATEWAY` | `received_at_ms`, `cause`, `claimed_agent_id` | FAIT (§ 3 ; Scénarios, 2) |
| 1 | `RATE_LIMITED` | `GATEWAY` | `received_at_ms`, `limit`, `window_s` | FAIT (§ 7) |
| 2 | `DETECTION` | `GATEWAY` | `score`, `threshold`, `verdict`, `reason_codes`, `received_at_ms`, `detected_at_ms`, `detector_version` | FAIT (§ 3) |
| 3 | `REQUEST_PARSED` | `GATEWAY` | `action`, `ref_id` | FAIT (§ 3) |
| 3, 6 à 8 | `SCHEMA_REJECTED` | `GATEWAY`, `QUEUE`, `RELAY` | `error_count` | FAIT (§ 3) |
| 3 bis | `QUARANTINED` | `RESPONSE` | `incident_id`, `document_sha256` | FAIT (§ 3) |
| 3 bis | `AGENT_PAUSED` | `RESPONSE` | `incident_id`, `scope`, `tx_hash` | FAIT (§ 3) |
| 3 bis | `ALERT_SENT` | `RESPONSE` | `incident_id`, `kind`, `recipients` | FAIT (§ 3) |
| 3 bis | `INCIDENT_REPORT_GENERATED` | `RESPONSE` | `incident_id`, `report_sha256`, `journal_head_seq`, `journal_head_hash` | FAIT (§ 3) |
| 4 | `FORWARDED_TO_CLIENT_AI` | `GATEWAY` | aucun | FAIT (§ 3) |
| 6 | `REQUEST_SIGNED` | `CLIENT_AI` | `action`, `ref_id`, `issued_at`, `expires_at`, `signer`, `request_digest` | FAIT (§ 3) |
| 7 | `ENQUEUED` | `QUEUE` | `expires_at` | FAIT (§ 3) |
| 8 | `SUBMITTED` | `RELAY` | `tx_hash` | FAIT (§ 3) |
| 7 | `QUEUE_EXPIRED` | `QUEUE` | `expires_at` | PROPOSÉ (Scénarios, 5 : « La demande expire ») |
| 9, 10 | `DECISION_OBSERVED` | `RESPONSE` | `decision`, `reason`, `action`, `ref_id`, `tx_hash`, `block_number`, `block_timestamp`, `log_index` | PROPOSÉ |
| hors flux | `HUMAN_DECISION` | `HUMAN` | `incident_id`, `decision`, `author_role`, `author_id` | PROPOSÉ (PLAYBOOK, étapes 4 et 5) |

Précisions :

- Les étapes 9 et 10 sont des événements du contrat, pas des entrées de journal (PROPOSITION § 3). `DECISION_OBSERVED` est leur copie, écrite par le service de réponse quand il lit l'événement dans l'indexeur. Elle est nécessaire : le rapport d'incident, « prérempli depuis le journal », doit porter la décision et le motif du contrat. La source de vérité reste la chaîne.
- Les étapes 5, 11 et 12 n'écrivent rien. FAIT (§ 3).
- `FORWARDED_TO_CLIENT_AI` est inscrit avant l'appel à l'IA du client ; un 502 sans `REQUEST_SIGNED` derrière montre une transmission qui n'a pas abouti.
- `AUTH_REJECTED` : `agent_id` vaut `null`, puisque personne n'est authentifié. L'identifiant déclaré va dans `data.claimed_agent_id`. Aucune réaction ne vise un agent sur la foi d'un identifiant déclaré.
- `AGENT_PAUSED` est écrite une fois par niveau : `scope` vaut `OFFCHAIN` (porte d'entrée et relais, immédiat) puis `ONCHAIN` (transaction du gardien confirmée, `tx_hash` renseigné). Point b.
- `ALERT_SENT.kind` : `SECURITY`, `REPETITION`, `AVAILABILITY`, `APPROVAL_REQUESTED`. `recipients` : des rôles (`ANALYST`, `TREASURER`, `APPROVER`, `OPERATIONS`), jamais une adresse ou un nom.
- `document_sha256` est l'empreinte du document reçu. Le document lui-même reste dans la quarantaine, hors du journal.
- `DECISION_OBSERVED.reason` est le code numérique du contrat, pas son nom : un code inconnu reste journalisable.

## 4. Forme canonique et empreinte

PROPOSÉ dans son détail ; le principe est FAIT (§ 7).

```
corps(n)  = l'entrée n privée de ses champs « hash » et « prev_hash »
H(n)      = SHA-256( UTF-8( JCS( corps(n) ) ) ‖ H(n−1) )
H(−1)     = 32 octets nuls
```

- JCS est la forme canonique de la RFC 8785 : clés triées, aucun espace, échappement des chaînes fixé. Ici elle se réduit au tri des clés et à l'écriture décimale des entiers, puisque le journal ne contient aucun nombre à virgule.
- `H(n−1)` est concaténé sous sa forme brute de 32 octets, pas sous sa forme hexadécimale.
- Valeur de départ : `prev_hash` de l'entrée 0 vaut 64 zéros.
- `seq` fait partie du corps : changer le rang d'une entrée change son empreinte.
- Les chaînes ne subissent aucune normalisation Unicode.
- L'**empreinte de tête** est le `hash` de la dernière entrée. Avec `seq`, elle résume tout le journal.

## 5. Script de vérification

Le script appartient à `response/` (Loris). Son comportement est gelé ici. PROPOSÉ.

```
verify-journal <fichier> [--expect-head <empreinte>] [--expect-seq <n>]
```

Pour chaque ligne, dans l'ordre, il s'arrête au premier défaut :

| Ordre | Contrôle | Défaut signalé |
|---|---|---|
| 1 | La ligne est un JSON conforme au schéma | `FORMAT` |
| 2 | `seq` égale le rang de la ligne, à partir de 0 | `SEQ_MISMATCH` |
| 3 | `prev_hash` égale le `hash` de la ligne précédente, ou la valeur de départ | `PREV_MISMATCH` |
| 4 | `hash` égale l'empreinte recalculée | `HASH_MISMATCH` |

Puis, si l'option est donnée : la dernière entrée a le `seq` et le `hash` attendus.

| Code de sortie | Sens |
|---|---|
| 0 | Chaîne intègre, et tête conforme si elle était demandée |
| 1 | Chaîne rompue : `SEQ_MISMATCH`, `PREV_MISMATCH` ou `HASH_MISMATCH` |
| 2 | Fichier illisible ou entrée non conforme au schéma : `FORMAT` |
| 3 | Chaîne intègre, mais tête différente de celle attendue : `HEAD_MISMATCH` |
| 64 | Erreur d'usage |

En cas de défaut, le script écrit sur la sortie d'erreur le rang de l'entrée et
le défaut. En cas de succès, il écrit le nombre d'entrées et l'empreinte de tête.

Ce que le script détecte, avec un fichier de preuve pour chaque cas :

| Altération | Détection | Fichier |
|---|---|---|
| Aucune | Code 0 | [chaine-valide.jsonl](examples/journal/chaine-valide.jsonl) |
| Entrée modifiée | `HASH_MISMATCH` à l'entrée modifiée | [chaine-modifiee.jsonl](examples/journal/chaine-modifiee.jsonl) |
| Entrée supprimée au milieu | `SEQ_MISMATCH` à la place de l'entrée retirée | [chaine-supprimee.jsonl](examples/journal/chaine-supprimee.jsonl) |
| Entrées réordonnées | `SEQ_MISMATCH` à la première entrée déplacée | [chaine-reordonnee.jsonl](examples/journal/chaine-reordonnee.jsonl) |

Si l'auteur de l'altération renumérote `seq` pour masquer un trou, le chaînage ne
correspond plus : le défaut devient `PREV_MISMATCH` à la place de l'entrée
retirée, car l'entrée qui prend son rang pointe encore vers l'empreinte retirée,
et ce contrôle passe avant celui de l'empreinte. S'il recolle aussi `prev_hash`,
c'est l'empreinte qui ne correspond plus : `HASH_MISMATCH`. L'altération est
détectée dans les deux cas.

FAIT : « une entrée modifiée » et « une entrée supprimée » font échouer la
vérification (PLANNING § 3 ; CHECKLIST). L'entrée réordonnée est PROPOSÉE.

`make specs` rejoue ces contrôles sur les fichiers ci-dessus : ils servent de
vecteurs à l'implémentation de Loris.

## 6. Limite : ce que la chaîne seule ne détecte pas

La chaîne ne contient aucun secret. Elle détecte une altération faite sans
recalcul, pas une altération faite par quelqu'un qui recalcule.

| Altération | Résultat de la vérification sans option | Fichier |
|---|---|---|
| Les dernières entrées sont supprimées | Code 0 : la chaîne restante est cohérente | [chaine-tronquee.jsonl](examples/journal/chaine-tronquee.jsonl) |
| Une entrée est falsifiée, puis toutes les empreintes suivantes sont recalculées | Code 0 | [chaine-reecrite.jsonl](examples/journal/chaine-reecrite.jsonl) |

Dans les deux cas, l'empreinte de tête change. La parade est donc de conserver
l'empreinte de tête **hors du journal**, puis de vérifier avec `--expect-head` :
la sortie devient 3.

| Mesure | Statut |
|---|---|
| Chaque rapport d'incident porte `journal_head` (`seq` et `hash`) au moment de sa génération | FAIT (PLAYBOOK, « Contenu du rapport ») |
| Le dashboard affiche l'empreinte de tête courante et son `seq` | PROPOSÉ |
| Ancrage optionnel : publier périodiquement l'empreinte de tête et son `seq` sur la chaîne, par un petit contrat séparé du coffre | PROPOSÉ, premier à couper |

L'ancrage reste hors de l'interface du coffre : le coffre ne garde que ce qui
décide d'un paiement. Une tête ancrée ne porte que deux valeurs opaques, donc
aucune donnée nominative.

Conséquence pour les livrables : la phrase « confirme qu'aucune entrée n'a été
modifiée ou retirée » (CONFORMITE, étape 4) n'est vraie qu'avec une tête de
référence. À formuler ainsi, ou à compléter par « par rapport à l'empreinte
portée par le rapport ».

Autre limite : le service de journal est de confiance au moment de l'écriture. Une
entrée fausse dès l'origine est chaînée comme les autres.

## 7. Exemples d'entrées

| Fichier | Issue attendue |
|---|---|
| [valid/01-decision-humaine.json](examples/journal/valid/01-decision-humaine.json) | Valide |
| [valid/02-jeton-rejete.json](examples/journal/valid/02-jeton-rejete.json) | Valide : `agent_id` à `null`, identifiant déclaré dans `data` |
| [invalid/01-type-inconnu.json](examples/journal/invalid/01-type-inconnu.json) | Rejet par le schéma : type hors liste |
| [invalid/02-champ-inconnu-dans-data.json](examples/journal/invalid/02-champ-inconnu-dans-data.json) | Rejet par le schéma : champ libre dans `data` |
| [invalid/03-nombre-a-virgule.json](examples/journal/invalid/03-nombre-a-virgule.json) | Rejet par le schéma |
| [invalid/04-sans-empreinte-precedente.json](examples/journal/invalid/04-sans-empreinte-precedente.json) | Rejet par le schéma |
