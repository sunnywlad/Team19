# 01. Demande signée

Interface entre Loris (porte d'entrée), Joseph (relais) et Wladimir (contrat).
Statuts : voir [README.md](README.md).

## 1. Périmètre

La demande signée est l'objet émis par l'IA du client à l'étape 6, transporté par
la file et le relais (étapes 7 et 8), vérifié par le contrat à l'étape 9.
FAIT (PROPOSITION § 3).

Elle ne porte que des identifiants. Le montant et le bénéficiaire sont lus dans
les registres du contrat. FAIT (PROPOSITION § 5).

Ce n'est pas l'objet que l'agent demandeur envoie à l'étape 1 : celui-ci n'est
pas signé par le client et n'est décrit par aucune source. Voir
[03-detecteur.md](03-detecteur.md) § 2 et [00-a-trancher.md](00-a-trancher.md), point i.

## 2. Champs

Schéma : [schemas/request.schema.json](schemas/request.schema.json).

| Champ | Type JSON | Type signé | Sens | Statut |
|---|---|---|---|---|
| `request_id` | identifiant opaque | `bytes32 requestId` | Unique, consommé une seule fois par le contrat | FAIT (§ 5), type PROPOSÉ |
| `client_id` | identifiant opaque | `bytes32 clientId` | Client dont la clé signe | FAIT (§ 5), type PROPOSÉ |
| `agent_id` | identifiant opaque | `bytes32 agentId` | Agent d'origine de la demande | FAIT (§ 5), type PROPOSÉ |
| `action` | `"PAY_INVOICE"` ou `"PLACE"` | `uint8 action` : 1 ou 2 | Payer une facture, ou exécuter un placement préenregistré | FAIT (§ 5), codage PROPOSÉ |
| `ref_id` | identifiant opaque | `bytes32 refId` | Facture, ou action préenregistrée | FAIT (§ 5), type PROPOSÉ |
| `issued_at` | entier, secondes Unix | `uint64 issuedAt` | Émission | FAIT (§ 5), type PROPOSÉ |
| `expires_at` | entier, secondes Unix | `uint64 expiresAt` | Fin de validité, incluse | FAIT (§ 5), type PROPOSÉ |
| `signature` | `0x` + 130 chiffres hexadécimaux | hors données signées | Signature du client sur les sept champs ci-dessus | FAIT (§ 5), format PROPOSÉ |

Le code d'action `0` n'existe pas : une valeur par défaut ne désigne jamais une
action valide. PROPOSÉ.

`request_id` est attribué par la porte d'entrée à l'arrivée de la demande
(étape 1) et recopié tel quel par l'IA du client dans la demande signée. Un seul
identifiant suit donc la demande de l'arrivée à la décision, ce qui est le
parcours de vérification de l'auditeur (CONFORMITE, « Comment un auditeur vérifie
une décision »). PROPOSÉ, point i.

## 3. Schéma strict

Tout champ inconnu, manquant ou mal typé entraîne un rejet.
FAIT (PROPOSITION § 5 ; PLANNING § 3, trois tests de schéma).

Le schéma est appliqué deux fois, parce que la demande change de mains entre les
deux. PROPOSÉ.

| Où | Qui | En cas d'échec |
|---|---|---|
| À la sortie de l'IA du client, avant la mise en file (étapes 6 et 7) | File | La demande n'entre pas dans la file. Entrée de journal `SCHEMA_REJECTED` |
| Avant la soumission (étape 8) | Relais | La demande n'est pas soumise. Entrée de journal `SCHEMA_REJECTED` |

Le contrat ne lit pas de JSON : il reçoit les sept champs typés et la signature.
Une demande altérée en route a une signature invalide.

## 4. Fenêtre de validité

`expires_at` vient « quelques minutes » après `issued_at`. FAIT (PROPOSITION § 5).
Les valeurs chiffrées sont PROPOSÉES.

| Règle | Valeur | Qui la vérifie | Rejet |
|---|---|---|---|
| Durée de vie : `0 < expires_at − issued_at ≤ MAX_TTL` | `MAX_TTL` = 300 s | File, relais, contrat | `VALIDITY_WINDOW_INVALID` |
| Pas d'émission dans le futur : `issued_at ≤ maintenant + MAX_CLOCK_SKEW` | `MAX_CLOCK_SKEW` = 60 s | File, relais, contrat | `VALIDITY_WINDOW_INVALID` |
| Non expirée : `maintenant ≤ expires_at` | | Relais, contrat | `REQUEST_EXPIRED` |

Pour le contrat, « maintenant » est l'horodatage du bloc. La fenêtre est contrôlée
avant l'expiration. Ces deux règles ne s'expriment pas en JSON Schema : le
contrôle `make specs` les rejoue sur les exemples.

Sans la borne sur la durée de vie, un client pourrait signer une demande valable
des années et l'expiration ne protégerait plus rien.

Pour la démo, le client signe avec une durée courte, de l'ordre de 30 s : les
attentes de la scène sont en secondes (CHECKLIST, « Démo »). PROPOSÉ.

## 5. Signature

EIP-712, données typées. PROPOSÉ. Les sources disent seulement « signature du
client sur tous les champs ci-dessus ».

### Domaine

| Champ | Valeur |
|---|---|
| `name` | `ArgentVault` |
| `version` | `1` |
| `chainId` | celui de la chaîne : 31337 en local ; Fuji : 43113, à vérifier par `eth_chainId` avant le déploiement |
| `verifyingContract` | adresse du contrat déployé |

### Type

```
Request(bytes32 requestId,bytes32 clientId,bytes32 agentId,uint8 action,bytes32 refId,uint64 issuedAt,uint64 expiresAt)
```

Empreinte du type (`keccak256` de la ligne ci-dessus) :
`0x9c20c49ec3a8f2638d52c8199e76df714419f6e2a1e6e4fba13f13ab7e7c6ce2`.

L'empreinte à signer est `keccak256(0x1901 ‖ séparateur de domaine ‖ empreinte de la structure)`.

### Ce que le domaine empêche

| Rejeu | Protection |
|---|---|
| Sur un autre contrat | `verifyingContract` |
| Sur une autre chaîne | `chainId` |
| Sur le même contrat | `request_id` consommé une seule fois ([02-contrat.md](02-contrat.md) § 5) |
| Après redéploiement du contrat | nouvelle adresse, donc nouveau domaine : les anciennes signatures ne valent plus |

### Format et règles

- 65 octets `r ‖ s ‖ v`, avec `v` égal à 27 ou 28.
- `s` dans la moitié basse de la courbe. Une signature à `s` haut est refusée : sans cela, toute signature a une jumelle valide.
- Le signataire attendu est l'adresse enregistrée dans le contrat pour `client_id` (`clientSigner()`). Un seul client : plusieurs clients sont hors périmètre. FAIT (PROPOSITION § 8).
- Pas de signature de message brut (`eth_sign`, `personal_sign`) : elle ne lie ni le contrat ni la chaîne.
- Le contrat refuse une signature invalide par un événement, pas par un échec de transaction, et ne consomme pas `request_id` dans ce cas. Voir [02-contrat.md](02-contrat.md) § 5.

## 6. Exemples et vecteurs de test

Aucune clé privée dans le dépôt, même de test. FAIT (CHECKLIST, « Règles du hackathon »).

| Fichier | Issue attendue |
|---|---|
| [valid/01-paiement-facture.json](examples/request/valid/01-paiement-facture.json) | Valide |
| [valid/02-placement.json](examples/request/valid/02-placement.json) | Valide |
| [valid/03-facture-au-dessus-du-seuil.json](examples/request/valid/03-facture-au-dessus-du-seuil.json) | Valide, aux deux bornes : durée de vie de 300 s, lue à l'instant `expires_at` |
| [invalid/01-champ-inconnu.json](examples/request/invalid/01-champ-inconnu.json) | Rejet par le schéma : champ `amount` |
| [invalid/02-champ-manquant.json](examples/request/invalid/02-champ-manquant.json) | Rejet par le schéma : `agent_id` absent |
| [invalid/03-mauvais-type.json](examples/request/invalid/03-mauvais-type.json) | Rejet par le schéma : `issued_at` en chaîne |
| [invalid/04-expiree.json](examples/request/invalid/04-expiree.json) | Schéma et signature valides ; `REQUEST_EXPIRED` |
| [invalid/05-duree-trop-longue.json](examples/request/invalid/05-duree-trop-longue.json) | Schéma et signature valides ; `VALIDITY_WINDOW_INVALID` (301 s) |

L'instant de lecture de chaque exemple est le champ `now` de
[examples/request/manifest.json](examples/request/manifest.json).

[examples/request/vectors.json](examples/request/vectors.json) donne, pour les cinq
demandes signées : les données typées, l'empreinte de la structure, l'empreinte à
signer, la signature et l'adresse attendue (`expected_signer`). Le domaine des
vecteurs est `chainId` 31337 et le contrat factice `0x1111…1111`.

Les vecteurs ont été contrôlés de deux façons indépendantes au moment de leur
génération : par `cast wallet verify`, et par un `ecrecover` écrit en Solidity.

Pour s'en servir dans les tests du contrat : placer le contrat à l'adresse
`0x1111111111111111111111111111111111111111` sur la chaîne 31337, enregistrer
`expected_signer` comme signataire du client, régler l'horloge sur `now`. Le
moyen de placer le contrat à une adresse choisie dépend de l'outil de test : à
vérifier par Wladimir. Les deux derniers vecteurs servent aux tests « demande
expirée » et « fenêtre invalide ».

Pour tous les autres tests, la clé du client est créée pendant le test et n'en
sort pas.

Régénération : `node specs/tools/gen-request-vectors.js`. La clé est tirée au
hasard en mémoire, jamais écrite ni affichée. Chaque exécution change donc
l'adresse attendue et les cinq signatures ensemble.

## 7. Limites

- La signature prouve que la clé du client a signé ces sept champs. Elle ne prouve pas que l'IA du client a eu raison de le faire : c'est le scénario 4.
- `agent_id` est affirmé par le client, pas par l'agent. Le contrat ne peut pas vérifier qu'il désigne le véritable agent d'origine.
- Une clé de client compromise sort du modèle, comme un propriétaire compromis (PROPOSITION § 9).
