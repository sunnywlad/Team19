# relay/ : agents scriptés, client signataire, file, relais, indexeur

Entre la porte d'entrée et le contrat. Rien ici ne décide ni ne paie : la
décision se lit dans l'événement `Decision` du contrat. Une panne vaut refus.

Les interfaces viennent de [../specs/](../specs/) et ne sont pas redéfinies ici.

## Composants

| Fichier | Rôle |
|---|---|
| [src/signer.ts](src/signer.ts) | Bouchon de l'IA du client : construit et signe la demande (EIP-712) |
| [src/agents.ts](src/agents.ts) | Agents scriptés des huit scénarios, un agent demandeur par scène |
| [src/queue.ts](src/queue.ts) | File SQLite : schéma strict à l'entrée, idempotente, ne modifie jamais une demande |
| [src/relay.ts](src/relay.ts) | Relais : soumet avec la clé `RELAYER`, échoue fermé |
| [src/indexer.ts](src/indexer.ts), [src/api.ts](src/api.ts) | Indexeur idempotent et API en lecture seule sur `127.0.0.1` |
| [src/vault.ts](src/vault.ts) | `VaultClient` : [fake-vault.ts](src/fake-vault.ts) pour les tests, [chain-vault.ts](src/chain-vault.ts) pour la chaîne |
| [src/config.ts](src/config.ts) | Constantes des points de `specs/00-a-trancher.md` et noms des variables d'environnement |

## Bouchons à remplacer

| Bouchon | Fichier | À remplacer par |
|---|---|---|
| Porte d'entrée | [src/gateway-stub.ts](src/gateway-stub.ts) | `gateway/` (Loris). Le bouchon rend le verdict écrit dans la scène, il n'analyse rien |
| Journal | `MemoryJournal` dans [src/journal.ts](src/journal.ts), seulement si `JOURNAL_URL` est absente | Avec `JOURNAL_URL`, [src/http-journal.ts](src/http-journal.ts) remet chaque entrée au service de `response/`. Sans réponse du service, rien n'entre en file et rien n'est soumis |
| Alertes | `MemoryAlerts`, `stderrAlerts` | Le service de réponse, derrière `AlertSink` |
| Pause hors chaîne | `StaticPauseSource` dans [src/pauses.ts](src/pauses.ts) | La liste tenue par le service de réponse, derrière `PauseSource` |
| Contrat | `FakeVault`, et [test/fixtures/StubVault.sol](test/fixtures/StubVault.sol) sur anvil | Le contrat de `contracts/` (Wladimir), par `ChainVault` |

## Vérifier

```bash
make relay
```

Types puis tests, dépendances installées depuis le lockfile. Dans `relay/` :

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
```

Le test sur chaîne locale demande `anvil` et `forge` ; sans eux, il est ignoré.

```bash
npm run test:anvil
```

Il déploie une doublure du contrat, pas le coffre : il prouve l'encodage de
`submit()` et le décodage de `Decision`, pas les règles de paiement.

## Lancer contre un contrat déployé

Les noms de variables sont dans [.env.example](.env.example). Ne jamais écrire de
clé dans le dépôt.

```bash
npm start
```

```bash
npm run scene -- 1
```

`npm start` lance le relais, l'indexeur et l'API. `npm run scene` joue une scène
dans la même file. Sans `RPC_URL`, sans `VAULT_ADDRESS` ou sans `RELAYER`, le
relais ne soumet rien et les demandes expirent.

Sur anvil, l'adresse de `RELAYER` doit être celle du rôle relais du contrat, et
celle de `CLIENT_SIGNER` son `clientSigner()`.

## API en lecture seule

`GET` uniquement, sur `127.0.0.1`. Toute autre méthode reçoit `405`.

| Route | Contenu |
|---|---|
| `/health` | État du service |
| `/status` | Prochain bloc à lire, confirmations, nombre d'événements |
| `/decisions?request_id=&since_id=&limit=` | Événements `Decision`, dans l'ordre d'indexation |
| `/decisions/<request_id>` | Décision courante d'une demande : son dernier événement |
| `/events?name=&since_id=&limit=` | Tous les événements du contrat (`Paid`, `HoldPlaced`, pauses…) |
| `/queue` | État de la file, sans le contenu des demandes ni leur signature |
| `/vault` | Vues du coffre lues au même bloc (cash, dettes admises, réserve, bloqué, plaçable, seuil, pause). Une vue illisible vaut `null`. `503` si le coffre est injoignable |

Chaque décision porte `tx_hash`, `log_index`, `block_number` et
`block_timestamp`. `effective_decision` vaut 0 dès que le motif est inconnu.
Pour suivre les nouveautés, relire avec `since_id` égal au dernier `id` reçu.

## Comportements à connaître

- **Rejeu.** La file déduplique par `request_id` : une demande remise en file telle quelle n'est soumise qu'une fois. `queueDedupByRequestId` à `false` redonne le scénario 8 a de `specs/` : le rejeu est soumis et le contrat le refuse.
- **Dans le doute.** Si la réponse du nœud se perd pendant l'envoi, ou si le processus s'arrête en pleine soumission, la demande passe à `IN_DOUBT`. Elle n'est jamais renvoyée automatiquement : son identifiant a pu être consommé. L'index dit ce qui s'est passé.
- **Agent en pause.** Le relais écarte la demande (`REJECTED`, `AGENT_PAUSED`). S'il ne peut pas lire l'état de pause, il n'envoie rien.
- **Confirmations.** L'indexeur n'écrit un événement qu'après `CONFIRMATIONS` blocs. Les délais mesurés en aval l'incluent.
