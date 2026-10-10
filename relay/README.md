# relay/ : agents scriptés, client signataire, file, relais, indexeur

Entre la porte d'entrée et le contrat. Rien ici ne décide ni ne paie : la
décision se lit dans l'événement `Decision` du contrat. Une panne vaut refus.

Les interfaces viennent de [../specs/](../specs/) et ne sont pas redéfinies ici.

## Composants

| Fichier | Rôle |
|---|---|
| [src/signer.ts](src/signer.ts) | Signataire du client : construit et signe la demande (EIP-712) |
| [src/client-ia.ts](src/client-ia.ts) | Service « IA du client » : reçoit une demande acceptée, la signe, la dépose dans la file |
| [src/agents.ts](src/agents.ts) | Agents scriptés des huit scénarios, un agent demandeur par scène |
| [src/queue.ts](src/queue.ts) | File SQLite : schéma strict à l'entrée, idempotente, ne modifie jamais une demande |
| [src/relay.ts](src/relay.ts) | Relais : soumet avec la clé `RELAYER`, échoue fermé |
| [src/pauses.ts](src/pauses.ts) | Sources de pause d'un agent : service de réponse (HTTP) et contrat. En pause dès qu'une le dit |
| [src/indexer.ts](src/indexer.ts), [src/api.ts](src/api.ts) | Indexeur idempotent et API en lecture seule sur `127.0.0.1` |
| [src/vault.ts](src/vault.ts) | `VaultClient` : [fake-vault.ts](src/fake-vault.ts) pour les tests, [chain-vault.ts](src/chain-vault.ts) pour la chaîne |
| [src/config.ts](src/config.ts) | Constantes des points de `specs/00-a-trancher.md` et noms des variables d'environnement |

## Bouchons à remplacer

| Bouchon | Fichier | À remplacer par |
|---|---|---|
| Porte d'entrée | [src/gateway-stub.ts](src/gateway-stub.ts) | `gateway/` (Loris). Le bouchon rend le verdict écrit dans la scène, il n'analyse rien |
| Journal | `MemoryJournal` dans [src/journal.ts](src/journal.ts), seulement si `JOURNAL_URL` est absente | Avec `JOURNAL_URL`, [src/http-journal.ts](src/http-journal.ts) remet chaque entrée au service de `response/`, par une boîte d'envoi. Sans réponse du service, rien n'entre en file et rien n'est soumis |
| Alertes | `MemoryAlerts`, `stderrAlerts` | Le service de réponse, derrière `AlertSink` |
| Pause hors chaîne | `StaticPauseSource` dans [src/pauses.ts](src/pauses.ts), seulement si `PAUSE_SOURCE_URL` est absente | Avec `PAUSE_SOURCE_URL`, `HttpPauseSource` lit `GET /agents/paused` du service de `response/`. Sans réponse lisible, rien n'est soumis |
| IA du client | [src/client-ia.ts](src/client-ia.ts) signe tout ce qui est conforme, sans modèle | Un vrai jugement avant signature |
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

```bash
npm run start:client-ia
```

`npm start` lance le relais, l'indexeur et l'API. `npm run start:client-ia` lance
le service « IA du client » sur la même file. `npm run scene` joue une scène
dans la même file, sans passer par ce service. Sans `RPC_URL`, sans `VAULT_ADDRESS` ou sans `RELAYER`, le
relais ne soumet rien et les demandes expirent.

Sur anvil, l'adresse de `RELAYER` doit être celle du rôle relais du contrat, et
celle de `CLIENT_SIGNER` son `clientSigner()`.

## Service « IA du client »

`POST /accepted` sur `127.0.0.1`, port `CLIENT_IA_PORT` (8770 par défaut). La
porte d'entrée y transmet chaque demande acceptée, avec
`CLIENT_AI_URL=http://127.0.0.1:8770/accepted`. Il lui faut `CLIENT_SIGNER`,
`VAULT_ADDRESS`, `CHAIN_ID` et la même `QUEUE_DB` que le relais.

Corps JSON, `content-type: application/json`, 4 Ko au plus : `request_id`,
`agent_id`, `client_id`, `action` (`PAY_INVOICE` ou `PLACE`), `ref_id`. Rien
d'autre : un montant, un bénéficiaire ou un document font rejeter la demande.

| Réponse | Sens |
|---|---|
| `202` `{ status: "accepted", request_id, duplicate }` | Signée, journalisée (`REQUEST_SIGNED`) et en file. `duplicate: true` : déjà en file, rien n'a été refait |
| `400` `{ error }` | Hors schéma (`invalid_body`), client autre que celui de la clé (`unknown_client`), ou `request_id` déjà en file avec un autre contenu (`request_id_conflict`) |
| `502` `{ error: "queue_unavailable" }` | Journal ou file injoignable : rien n'est pris en compte, la porte peut réessayer |

Limites :

- Aucun modèle : tout ce qui est conforme est signé. La signature ne prouve pas que la demande est légitime (scénario 4).
- Aucune authentification : quiconque atteint le port obtient une demande signée. Le service n'écoute que sur `127.0.0.1` et refuse un appel venu d'une page web (`403`).
- Une demande refusée par un `502` laisse son `REQUEST_SIGNED` au journal ou dans la boîte d'envoi ; la reprise en écrit un second, pour une nouvelle signature.

## API en lecture seule

`GET` uniquement, sur `127.0.0.1`. Toute autre méthode reçoit `405`.

| Route | Contenu |
|---|---|
| `/health` | État du service |
| `/status` | Prochain bloc à lire, confirmations, nombre d'événements |
| `/decisions?request_id=&since_id=&limit=` | Événements `Decision`, dans l'ordre d'indexation |
| `/decisions/<request_id>` | Décision courante d'une demande : son dernier événement `Decision` qui n'est pas un refus de rejeu. Voir « Décision courante » |
| `/events?name=&since_id=&limit=` | Tous les événements du contrat (`Paid`, `HoldPlaced`, pauses…) |
| `/queue` | État de la file, sans le contenu des demandes ni leur signature |
| `/vault` | Vues du coffre lues au même bloc (cash, dettes admises, réserve, bloqué, plaçable, seuil, pause). Une vue illisible vaut `null`. `503` si le coffre est injoignable |

Chaque décision porte `tx_hash`, `log_index`, `block_number` et
`block_timestamp`. `effective_decision` vaut 0 dès que le motif est inconnu.
Pour suivre les nouveautés, relire avec `since_id` égal au dernier `id` reçu :
seules les lignes d'`id` strictement supérieur sont rendues. La clôture d'un cas 1
arrive ainsi comme une ligne à part, sous le `request_id` d'origine.

## Journal : boîte d'envoi et clé d'idempotence

Avec `JOURNAL_URL`, chaque entrée reçoit une clé d'idempotence (UUID) une seule
fois, à sa création. La clé et le corps sont écrits dans la boîte d'envoi
(`JOURNAL_OUTBOX_DB`, SQLite) avant le premier envoi.

- **Nouvelle tentative.** Une entrée restée sans réponse, ou reçue par un service en erreur (5xx), attend dans la boîte. Elle repart avec le même corps et la même clé, avant toute autre entrée et au début de chaque tour du relais, y compris après un redémarrage. Le service n'en écrit donc qu'une.
- **Contenu.** La clé ne dépend pas du contenu : deux entrées identiques, par exemple deux `SCHEMA_REJECTED` sans `request_id` et de même `error_count`, sont deux entrées du journal.
- **Échec fermé.** Tant qu'une entrée attend, l'appelant reçoit une erreur : rien n'entre en file, et le tour du relais s'arrête avant toute soumission.
- **Refus définitif.** Une entrée refusée par le service (4xx) n'est jamais renvoyée. Elle reste dans la boîte, marquée `REFUSED`, et le relais le signale sur sa sortie d'erreur.

Conséquence à connaître : une mise en file refusée faute de journal laisse son
`ENQUEUED` dans la boîte, alors que la demande n'est pas en file. Si la demande
est remise en file ensuite, le journal porte deux `ENQUEUED` pour elle : celui
de la tentative, puis celui de l'entrée réelle. Il en va de même pour
`REQUEST_SIGNED` après un `502` du service « IA du client ».

## Décision courante

`specs/02` § 8 et `IArgentVault.sol` disent : « la décision courante est celle du
dernier événement ». Pris à la lettre, c'est faux dès qu'un `request_id` est
rejoué : le contrat émet alors un `Decision` 0 `REQUEST_REPLAYED` sous le même
identifiant, et une demande en cas 1, dont le montant est toujours bloqué,
s'afficherait refusée.

Règle appliquée ici, côté relais seulement :

- La décision courante d'une demande est son dernier `Decision` dont le motif
  n'est pas `REQUEST_REPLAYED` (code 3).
- Une clôture de cas 1 (`APPROVED`, `APPROVAL_REFUSED`, `APPROVAL_TIMEOUT`) est
  un `Decision` ultérieur sous le même `request_id` : elle remplace le cas 1.
- Seul `/decisions/<request_id>` change. Sa réponse garde la même forme, sans
  champ ajouté. Les refus de rejeu restent dans `/decisions` et `/events`.
- Si l'index ne connaît que des rejeux pour une demande (indexeur démarré après
  la décision d'origine), la réponse est le dernier d'entre eux.

Non traité, à trancher : un `SIGNATURE_INVALID` émis sous le `request_id` d'une
demande déjà décidée la remplace encore. `specs/02` § 8 le range pourtant avec
les rejeux (« un même `requestId` peut porter plusieurs `SIGNATURE_INVALID` ou
`REQUEST_REPLAYED` »).

Phrase prête pour l'amendement de `specs/02` § 8 et du commentaire de
l'événement `Decision` dans `IArgentVault.sol` :

> La décision courante d'une demande est celle de son dernier événement
> `Decision` dont le motif n'est pas `REQUEST_REPLAYED` : le refus d'un rejeu
> juge la tentative de rejeu, pas la demande, et ne modifie ni son état ni un
> montant bloqué.

## Forme des événements

- `HoldPlaced.deadline`, comme tout `uint64` (`ApprovalDelayChanged`), est un
  nombre de secondes, avec `FakeVault` comme avec `ChainVault`. Les montants
  (`uint256`) restent des chaînes décimales.
- `FakeVault` émet `InvoiceRegistered` à l'inscription d'une facture. Il n'émet
  pas encore `PlacementRegistered`, `BeneficiaryRegistered` ni `AgentRegistered`.

## Comportements à connaître

- **Rejeu.** La file déduplique par `request_id` : une demande remise en file telle quelle n'est soumise qu'une fois. `queueDedupByRequestId` à `false` redonne le scénario 8 a de `specs/` : le rejeu est soumis et le contrat le refuse.
- **Dans le doute.** Si la réponse du nœud se perd pendant l'envoi, ou si le processus s'arrête en pleine soumission, la demande passe à `IN_DOUBT`. Elle n'est jamais renvoyée automatiquement : son identifiant a pu être consommé. L'index dit ce qui s'est passé.
- **Agent en pause.** Le relais écarte la demande (`REJECTED`, `AGENT_PAUSED`), que la pause vienne du service de réponse ou du contrat. S'il ne peut pas lire l'état de pause, il n'envoie rien : la demande attend, puis expire. La liste du service est gardée 2 s au plus ; 200 lignes ou plus valent « illisible », car le service coupe sa liste à 200.
- **Confirmations.** L'indexeur n'écrit un événement qu'après `CONFIRMATIONS` blocs. Les délais mesurés en aval l'incluent.
