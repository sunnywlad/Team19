# gateway/ : porte d'entrée

Implémentation de [specs/03-detecteur.md](../specs/03-detecteur.md) : étapes 1 à 4
du flux. La porte ne paie rien, ne décide d'aucune pause et ne transmet que des
identifiants.

| Étape | Contrôle | En cas d'arrêt |
|---|---|---|
| 1 | Jeton de l'agent : court, révocable, lié à un mandat | `TOKEN_INVALID`, `401` |
| 1 | Limite de débit : 5 demandes par agent sur 10 s | `RATE_LIMITED`, `429` |
| 2 | Détecteur : trois signaux, un score de 0 à 100, seuil 70 | `BLOCK`, `403`, document en quarantaine |
| 3 | Schéma strict du corps | `SCHEMA_INVALID`, `400` ou `413`, document en quarantaine |
| 4 | Transmission à l'IA du client | `502` si elle ne répond pas |

## Lancer

```bash
npm ci --ignore-scripts
```

```bash
npm start
```

| Variable | Défaut | Sens |
|---|---|---|
| `GATEWAY_PORT` | `8780` | Port d'écoute sur `127.0.0.1` |
| `JOURNAL_URL` | `http://127.0.0.1:8790` | Service de journal (`response/`) |
| `CLIENT_AI_URL` | absent | Où transmettre une demande acceptée. Absent : arrêt après l'étape 3 |
| `GATEWAY_AGENTS_FILE` | `specs/examples/fixtures.json` | Agents à enrôler, avec leur mandat |
| `GATEWAY_DATA_DIR` | `var/` | Jetons émis, quarantaine, sorties |

Aucune de ces variables n'est un secret.

Au démarrage, la porte émet un jeton par agent et écrit
`var/agent-tokens.json`, où les agents scriptés lisent le leur. Ce fichier n'est
jamais versionné. Les jetons valent 15 minutes : relancer la porte en émet de
nouveaux. Le registre ne garde que l'empreinte de chaque jeton.

## Envoyer une demande

`POST /requests`, en-tête `Authorization: Bearer <jeton>`, corps JSON de 16 Ko au
plus, conforme à [schemas/inbound.schema.json](schemas/inbound.schema.json) :

| Champ | Contenu |
|---|---|
| `agent_id` | Identifiant déclaré, 32 octets. Doit être celui du jeton |
| `client_id` | Client visé. Doit être celui du jeton |
| `action` | `PAY_INVOICE` ou `PLACE` |
| `ref_id` | Facture ou placement visé |
| `document` | Texte de la pièce, 8192 caractères au plus. Une donnée, jamais une instruction |

L'agent reçoit `{ "request_id", "status" }` avec `status` à `accepted` ou
`rejected`, et rien d'autre : ni score, ni code, ni seuil (specs/03 § 6).
`request_id` est attribué à l'arrivée, y compris aux demandes rejetées.

Ce schéma est la sixième interface (specs/00, point i). Il vit ici en attendant
d'être copié dans `specs/` par décision à quatre.

## Ce que l'IA du client reçoit

`request_id`, `agent_id`, `client_id`, `action`, `ref_id`. Jamais le document :
le texte reçu de l'extérieur n'atteint pas le composant qui signe les demandes.

## Lire les sorties

`GET /outputs?from=n&limit=m` rend les enregistrements de sortie conformes à
`specs/schemas/detector-output.schema.json`, pour le banc de mesure et le
dashboard. `GET /health` rend l'état du service.

## Détecteur

Règles déterministes, sans modèle (`src/detector.ts`). Le même document donne
toujours le même score, et chaque point du score se rattache à une règle nommée.

| Signal | Ce qu'il cherche |
|---|---|
| `INSTRUCTION_IN_DATA` | Contournement des règles, ordre de paiement chiffré, changement de rôle, fausse autorité, politique « levée », pression, texte caché (caractères invisibles, commentaire HTML, base64) |
| `AUTHORITY_VIOLATION` | Action absente du mandat de l'agent. Le mandat vient du jeton, jamais du corps |
| `PAYMENT_ANOMALY` | Changement de coordonnées, IBAN ou adresse de portefeuille, montant rectifié, doublon, rafale |

Le signal le plus fort porte le score, les deux autres le renforcent à moitié.
Un signal figure dans `reason_codes` à partir de 20, même sous le seuil.

## Mesurer

```bash
npm run bench -- bench/jeu-provisoire.jsonl
```

Une ligne du jeu :

```json
{"id": "a-001", "label": "attack", "family": "instruction-cachee", "action": "PAY_INVOICE", "mandate": ["PAY_INVOICE"], "document": "…"}
```

`label` vaut `legit` ou `attack`. Le banc réserve un tiers du jeu au réglage du
seuil et mesure sur le reste : rappel, précision, faux positifs, rappel par
famille, attaques manquées, temps de détection. `--threshold n` change le seuil,
`--json` sort le rapport pour la fiche de défense, `--min-recall` et
`--max-false-positives` en font un contrôle de non-régression.

Premiers chiffres, sur un jeu provisoire écrit par l'auteur des règles : 54,3 %
des attaques détectées, aucune facture légitime bloquée, sur 77 échantillons.
Détail, réserves et attaques manquées : [bench/README.md](bench/README.md).

## Pause d'un agent

La porte ne décide pas d'une pause, elle l'applique. À chaque demande, elle relit
le journal :

| Entrée de journal | Effet |
|---|---|
| `AGENT_PAUSED` | L'agent est refusé dès l'étape 1 : `AUTH_REJECTED`, cause `TOKEN_REVOKED` |
| `HUMAN_DECISION`, `AGENT_RESUMED` | La pause est levée |
| `HUMAN_DECISION`, `TOKEN_REVOKED` | Les jetons de l'agent sont révoqués définitivement |

Aucune route de la porte ne lève une pause.

## Garanties

- Le jeton est contrôlé avant toute lecture du contenu.
- Journal avant action : si le service de journal ne répond pas, tout est refusé (`503`).
- Un document bloqué est gelé dans `var/quarantine/`. Le journal n'en garde que l'empreinte.
- Aucun extrait du document dans le journal, dans une réponse ou dans une explication de score.

## Limites

- Des règles ne voient que ce qu'elles décrivent. Une attaque formulée autrement
  passe : c'est le scénario 4, que le contrat arrête ensuite. Les attaques
  manquées se lisent dans la sortie du banc.
- Les seuls chiffres de détection viennent d'un jeu provisoire écrit par l'auteur
  des règles. La mesure à présenter attend le jeu de `data/`.
- Doublon et rafale sont comptés en mémoire : un redémarrage les oublie.
- La porte n'authentifie pas le service de journal et n'écoute que sur `127.0.0.1`.
- Un corps au-delà de 16 Ko est tronqué avant analyse, puis rejeté.
