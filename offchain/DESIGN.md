# offchain : conception partagée (référence des sous-agents)

Sources qui font foi : `../docs/interface.md` (§ 1, 3, 7, 8, 9) et `../src/interfaces/IVerificationMarket.sol`. Ce fichier fixe seulement la structure du code et les choix laissés ouverts par l'interface.

## Pile

- Node 22, TypeScript exécuté directement (`node fichier.ts`, type stripping natif). Pas de build, pas de `tsc`. Donc : pas d'`enum`, pas de `namespace`, pas de propriétés de paramètres de constructeur ; imports relatifs avec l'extension `.ts` ; `import type` pour les types seuls.
- `"type": "module"`. Dépendance unique : `viem` `2.57.4` (version exacte). Serveurs HTTP avec `node:http`, sans framework.
- Tests : `node:test` + `node:assert/strict`, fichiers `test/*.test.ts`. `npm test` = `node --test --test-concurrency=1 test/`.
- Écoute sur `127.0.0.1` seulement.

## Arborescence

```
offchain/
  package.json  .gitignore  DESIGN.md  e2e.sh
  abi/market.ts            export const marketAbi = [...] as const  (généré depuis ../out/IVerificationMarket.sol/IVerificationMarket.json par scripts/gen-abi.sh)
  scripts/gen-abi.sh
  lib/config.ts            lecture des variables d'environnement, erreur claire si manquante
  lib/payload.ts           validatePayload(bytes) -> Payload | erreur ; deriveFacts(payload) -> Facts
  lib/hash.ts              contentHashOf(bytes), hashOf(facts, contentHash), commitmentOf({chainId, market, requestId, verifier, vote, reasons, detailHash, salt})
  lib/reasons.ts           table nom -> bit (§ 3), SCRIPT_REASONS, reasonsToMask(names) ; maskToReasons(mask)
  lib/readAuth.ts          readMessage(chainId, requestId, h, expiry) ; signRead(account, ...) -> headers ; verifyRead(headers, ...) -> address
  lib/chain.ts             publicClient(rpc, chainId), walletClient(key), définition de chaîne viem (id 191919 par défaut)
  lib/http.ts              petits utilitaires : lire le corps en Buffer, répondre JSON, erreurs
  cache/server.ts          port 8701
  gateway/server.ts        port 8700
  verifier/service.ts      une instance par VERIFIER_KEY
  evaluator-stub/index.ts  évaluateur factice
  test/                    tests + test/mock/ (contrat factice pour anvil)
  data/                    données locales, ignoré par git
  incidents.log            ignoré par git
```

## Types

- `Facts` en TS : `{ amount: bigint, currency: Hex /* bytes3, 0x + 6 hex */, beneficiaryId: Hex, referenceId: Hex }`. En JSON : `amount` en chaîne décimale.
- `hashOf` = `keccak256(encodeAbiParameters([{type:'tuple', components:[uint256 amount, bytes3 currency, bytes32 beneficiaryId, bytes32 referenceId]}, {type:'bytes32'}], [facts, contentHash]))`. Struct statique : son encodage égale celui des 4 champs à plat ; le test le vérifie contre le contrat et contre `cast`.
- `commitmentOf` = `keccak256(encodeAbiParameters([uint256 chainId, address market, uint256 requestId, address verifier, uint8 vote, uint16 reasons, bytes32 detailHash, bytes32 salt]))`.

## Validation du payload (§ 1)

Clés exactes, ni plus ni moins (y compris dans `plannedDecision`) : `schemaVersion` (=== 1), `requester` (adresse `0x` + 40 hex minuscules), `agentId` (chaîne), `prompt` (chaîne), `context` (objet non nul, non tableau), `plannedDecision` { `action` chaîne, `amountMinor` chaîne `^(0|[1-9][0-9]*)$` < 2^256, `currency` `^[A-Z]{3}$`, `beneficiaryId` chaîne non vide `^[A-Z0-9]+$`, `reference` chaîne }, `createdAt` (entier >= 0), `salt` (`0x` + 64 hex). Octets non UTF-8 ou JSON invalide : refusé.

## Variables d'environnement

| Variable | Qui | Défaut |
|---|---|---|
| `RPC_URL` | tous | RPC local de `etat-run.md` |
| `CHAIN_ID` | tous | `191919` |
| `MARKET_ADDRESS` | tous | aucun, obligatoire |
| `CACHE_URL` | passerelle, vérificateur | `http://127.0.0.1:8701` |
| `CACHE_PORT` / `GATEWAY_PORT` | | `8701` / `8700` |
| `CACHE_DATA_DIR` | cache | `offchain/data/cache` |
| `CACHE_WRITE_TOKEN` | cache, passerelle | obligatoire : `POST /content` exige `Authorization: Bearer <token>` |
| `SECURITY_ADDRESSES` | cache | liste d'adresses séparées par des virgules, vide par défaut |
| `GATEWAY_API_KEYS` | passerelle | liste de clés séparées par des virgules |
| `REQUESTER_KEY` | passerelle | clé privée du demandeur (démo, décision 6) |
| `VERIFIER_KEY` | vérificateur | clé privée du vérificateur |
| `VERIFIER_DATA_DIR` | vérificateur | `offchain/data/verifier-<adresse>` |
| `EVALUATOR_CMD` | vérificateur | `node evaluator-stub/index.ts` (lancé via `sh -c`) |
| `EVALUATOR_TIMEOUT_MS` | vérificateur | `90000` |
| `INCIDENTS_LOG` | vérificateur, passerelle | `offchain/incidents.log` |
| `POLL_MS` | services | `1000` |

Les chemins par défaut (`offchain/data/...`, `offchain/incidents.log`) sont résolus depuis le dossier `offchain/` lui-même (`import.meta.dirname`), jamais depuis le répertoire courant. Un chemin relatif passé par variable d'environnement est résolu depuis le répertoire courant.

Aucune clé n'est écrite dans un fichier versionné. Les tests utilisent les clés publiques d'anvil, dérivées à l'exécution (`mnemonicToAccount('test test test test test test test test test test test junk', {addressIndex: i})`).

## Cache (§ 8)

- Stockage disque : `data/cache/content/<h>.bin` (octets bruts reçus, jamais resérialisés), `<h>.facts.json`, `data/cache/detail/<requestId>/<verifier>.bin`. Écriture atomique (fichier temporaire puis `rename`).
- `POST /content` : corps JSON `{ payload: base64, facts: {amount, currency, beneficiaryId, referenceId} }`. Le cache valide le payload, vérifie que `facts` égale `deriveFacts(payload)` (sinon 400), calcule `contentHash` et `h`, stocke, rend `{ contentHash, h }`. Idempotent (même h : 200, même réponse).
- `GET /content/{h}?requestId=N` : en-têtes signés (§ 8). Contrôles : expiry dans le futur et à moins de 60 s ; signature valide ; `getRequest(N).h == h` ; rôle : membre du comité si statut `Commit` ou `Reveal`, `requester` si statut ∈ {Commit, Reveal, Contest}, adresse de `SECURITY_ADDRESSES` si statut `Contest`. Statut `Closed` ou `None` : 404. Rend `{ payload: base64, facts }`. 401 signature, 403 rôle, 404 inconnu.
- `POST /detail/{requestId}` : corps = octets bruts de la ligne. Accepté si `keccak256(octets)` égale le `detailHash` révélé (`getReveal`) d'au moins un membre du comité ; stocké sous ce vérificateur. Sinon 409. Sans signature : un dépôt adressé par son hash révélé n'apporte rien à un tiers (décision notée dans `etat-offchain.md`).
- `GET /detail/{requestId}` : mêmes en-têtes signés, avec le `h` de la demande lu sur la chaîne. Statut `Contest` seulement ; rôle `requester` ou sécurité. Rend `{ details: [{ verifier, detail: base64 }] }`.
- Suppression : boucle de surveillance de `RequestClosed` (getLogs par intervalle, dernier bloc lu gardé sur disque) ; efface contenu et détails de la demande. Le lien requestId → h vient de `getRequest`.

## Passerelle (§ 9)

- Toutes les routes exigent `Authorization: Bearer <clé de GATEWAY_API_KEYS>` (comparaison à temps constant). Sinon 401.
- `POST /requests` : si `INCIDENTS_LOG` existe et n'est pas vide, 503 (disjoncteur, § 7 ; l'opérateur vide le fichier pour rétablir). Valide le payload, exige `payload.requester` == adresse de `REQUESTER_KEY` (sinon 400), dérive `facts`, `POST /content` au cache, compare le `h` rendu au sien, envoie `createRequest(h)` avec `value = requestFee()`, attend le reçu, lit `RequestCreated`, rend `{ requestId, h, txHash, commitDeadline, revealDeadline }` (nombres en chaînes).
- `GET /requests/{id}` : `{ status, code?, deadlines }`, statut en nom (`Commit`…), `code` seulement à partir de `Contest`.
- `GET /requests/{id}/verdicts` : `VerdictRevealed` et `VerifierMissed` de la demande, plus détails du cache (lecture signée avec la clé du demandeur) si statut `Contest`.
- `POST /requests/{id}/finalize` : `finalize` puis, si l'échéance est passée, `close` ; rend l'état.
- `GET /events?fromBlock=N` : journaux décodés du marché, `bigint` en chaînes.
- `POST /rpc` : relais JSON-RPC, méthodes en lecture seule seulement (`eth_chainId`, `eth_blockNumber`, `eth_call`, `eth_getLogs`, `eth_getBlockByNumber`, `eth_getTransactionReceipt`, `eth_getBalance`, `eth_getCode`). Autre méthode : erreur JSON-RPC -32601.

## Service vérificateur (§ 1, 3, 7)

- Boucle de sondage des journaux `CommitteeDrawn` (et `RequestCreated` pour h et les échéances) depuis le dernier bloc traité, gardé sur disque avec l'état par demande (`data/verifier-<addr>/state.json` : vote, reasons, detailHash, salt, détail, étape). Reprise après redémarrage sans perte de sel.
- Demande où il est membre : lire `getRequest`, lire le cache (lecture signée), contrôler `hashOf(facts, keccak256(octets)) == h` puis `facts == deriveFacts(payload)`. Échec ou cache injoignable : vote 1, motif `content_mismatch`, ligne JSON appendue à `INCIDENTS_LOG` (`{ts, verifier, requestId, h, cause}`), sans lancer l'évaluateur.
- Évaluateur : `spawn('sh', ['-c', EVALUATOR_CMD])`, payload sur stdin, première ligne non vide de stdout ; délai dépassé : processus tué (groupe entier), vote 1, `evaluator_timeout`. Code non nul, JSON invalide, vote hors {0,1,2}, motif inconnu ou non posé par le script : vote 1, `evaluator_error`.
- Détail : la ligne rendue par le script, octets tels quels ; dans les cas du service, une ligne JSON produite par le service. `detailHash = keccak256(octets)`.
- Commit avec sel `crypto.randomBytes(32)` avant `commitDeadline`. Reveal dès `now >= commitDeadline + 2 s` et avant `revealDeadline`. Puis `POST /detail`. Puis `finalize` (dès que tous ont révélé ou après `revealDeadline` ; un revert parce qu'un autre l'a fait est normal), puis `close` après `contestDeadline`. Toute erreur de transaction est journalisée, l'étape réessayée au tour suivant.

## Évaluateur factice (§ 7)

`node evaluator-stub/index.ts` : lit tout stdin, parse le JSON, `amountMinor` en BigInt. `> 1000000` (10 000,00) : vote 0, `["amount_above_cap"]`. `> 100000` : vote 1, `["insufficient_context"]`. Sinon vote 2, `[]`. Payload illisible : code de sortie 1. Variables de test : `STUB_SLEEP_MS` (attente avant réponse), `STUB_EXIT` (code de sortie forcé). Une ligne JSON sur stdout, rien d'autre.

## Tests contre une chaîne

`test/mock/` : contrat factice `MockMarket.sol` qui implémente `IVerificationMarket` (importé depuis `../../../src/interfaces/IVerificationMarket.sol` via remapping), comité fixe de 3 au constructeur, fenêtres passées au constructeur, `hashOf` et `commitmentOf` conformes à l'interface, cycle complet. Compilé par `forge build` avec un `foundry.toml` propre à `test/mock/` (sortie et cache sous `test/mock/`), déployé sur `anvil --chain-id 191919 --port <libre>` lancé par les tests. Le vrai `VerificationMarket` de la session contrats le remplacera dans `e2e.sh`.
