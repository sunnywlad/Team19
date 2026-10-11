# Organisation des tests

Nous séparons les tests de contrat dans l'EVM de Foundry, les tests hors chaîne
sur anvil et les parcours effectivement joués sur le L1. Le marché et le coffre
sont éprouvés séparément ; aucune suite ne démontre leur jonction.

## Suites Foundry

Source des décomptes : `forge test --summary`, Forge 1.8.4. Les sorties brutes
sont extraites dans [preuves/gas-report-marche.md](preuves/gas-report-marche.md) et
[preuves/gas-report-vault.md](preuves/gas-report-vault.md), avec les commandes exécutées.
Les chemins sont relatifs à la racine du dépôt.

### Marché

| Fichier | Contrat de test | Ce qui est testé | Nombre de tests |
|---|---|---|---:|
| `test/VerificationMarket.t.sol` | `VerificationMarketTest` | Création, commit/reveal, horodatages, agrégation exhaustive, quorum, clôture, empreintes et fuzz | 65 |
| `test/VerifierRegistry.t.sol` | `VerifierRegistryTest` | Admission, caution, verrous cumulés, saisie, sortie et retrait de la liste active | 37 |
| `test/Slashing.t.sol` | `SlashingTest` | Absences, prédicats, contestation, saisie unique, strikes et exclusion | 29 |
| `test/Rewards.t.sol` | `RewardsTest` | Partage des frais, reliquat, bonus natif, retrait et double retrait refusé | 15 |
| `test/VetoDesk.t.sol` | `VetoDeskTest` | Opérateurs, émission native et rejet d'une référence de paiement rejouée | 12 |
| `test/Phase2.t.sol` | `Phase2Test` | Parcours cautionné, membre non inscrit et missions concurrentes | 3 |
| `test/DrawnVerificationMarket.t.sol` | `DrawnVerificationMarketTest` | Bloc de tirage, éligibilité, comité distinct, déterminisme, demande jamais tirée et parcours complet | 21 |
| `test/Phase3.t.sol` | `Phase3Test` | Réputation et validation, câblage unique, finalisation malgré un registre absent ou en échec | 12 |
| `test/erc8004/AgentIdentityRegistry.t.sol` | `AgentIdentityRegistryTest` | Identité, métadonnées, droits du propriétaire et jeton non transférable | 21 |
| `test/erc8004/AgentReputationRegistry.t.sol` | `AgentReputationRegistryTest` | Retours, révocation, filtres et agrégats | 19 |
| `test/erc8004/AgentValidationRegistry.t.sol` | `AgentValidationRegistryTest` | Demandes, réponses, droits et synthèses de validation | 19 |

Total du marché : **253 tests, aucun échec ni test ignoré**. Le contrat
`DrawnVerificationMarketTest_Twin` sert de doublure au tirage ; il ne porte
aucun test autonome et n'apparaît pas dans le résumé.

### Coffre ArgentVault, intégré à `wladimir`

| Fichier | Contrat de test | Ce qui est testé | Nombre de tests |
|---|---|---|---:|
| `test/ArgentVault.t.sol` | `ArgentVaultScenariosTest` | Scénarios d'acceptation du coffre et variantes d'approbation, expiration et rejeu | 12 |
| `test/ArgentVault.t.sol` | `ArgentVaultRolesTest` | Fonctions sensibles par rôle, fonctions sans rôle et constructeur | 20 |
| `test/ArgentVault.t.sol` | `ArgentVaultRulesTest` | Signature, domaine, fenêtre, mandat, ordre des refus, registres, fonds et paramètres | 22 |
| `test/ArgentVault.t.sol` | `ArgentVaultCase1AndPauseTest` | Blocage, approbation, refus, expiration, pauses, libération des fonds et revalidation du plaçable (M4) | 12 |
| `test/ArgentVault.t.sol` | `ArgentVaultReentrancyTest` | Bénéficiaire, relais et approbateur malveillants ; annulation sur transfert en échec | 5 |
| `test/ArgentVault.t.sol` | `ArgentVaultVectorsTest` | Vecteurs de signature, domaine, empreintes et décisions aux bornes | 7 |
| `test/ArgentVault.t.sol` | `ArgentVaultInvariantTest` | Paiement unique, conservation des fonds, réserve, montants bloqués et dettes | 1 campagne groupée |

Le résumé compte **79 tests pour le coffre**, soit 78 tests individuels et une
campagne groupant cinq fonctions `invariant_*`. Les deux tests ajoutés par le
correctif M4 (`cf9bab9`) sont `test_M4_placementNouvelleFacture_refuseSansPaiement`
et `test_M4_placementHausseReserve_refuseSansPaiement` : rouges avant le
correctif ([preuves/m4-tests-red.md](preuves/m4-tests-red.md)), verts après
([preuves/m4-forge-test-final.md](preuves/m4-forge-test-final.md)).

**Total de la branche intégrée : 332 tests Foundry (253 marché + 79 coffre),
18 suites, aucun échec ni test ignoré**, mesuré par `forge test --summary`.

## Familles et propriétés éprouvées

Les tests unitaires vérifient l'état et les événements, les bornes temporelles,
les erreurs, les montants et les destinataires. Les suites `Phase2Test` et
`Phase3Test` exercent l'assemblage des contrats du marché. La suite des rôles du
coffre vérifie la séparation propriétaire, admission, relais, approbateur et
gardien. Les suites de chaque contrat du marché contrôlent aussi leurs rôles.

Les **huit scénarios d'ArgentVault** donnent douze tests avec leurs variantes
(source : `specs/acceptance/scenarios.md` et `test/ArgentVault.t.sol:246`) :

| Scénario | Propriété testée dans le coffre |
|---|---|
| 1. Facture légitime | Décision 2, paiement au bénéficiaire inscrit et baisse conjointe du cash et des dettes |
| 2. Agent non reconnu | Signature forgée ou agent inconnu refusés, aucun paiement |
| 3. Facture piégée détectée | Pause de l'agent par le gardien, refus jusqu'à la reprise par le propriétaire |
| 4. Facture piégée non détectée | Référence inconnue refusée, aucun événement `Paid` |
| 5. Relais en panne | Demande soumise après expiration refusée, facture toujours due |
| 6. Montant au-dessus du seuil | Montant bloqué, paiement après approbation jusqu'à l'échéance incluse, expiration ou approbation tardive sans paiement |
| 7. Placement trop élevé | Dépassement du plaçable refusé, dettes et réserve protégées |
| 8. Rejeu et double paiement | Demande consommée et facture déjà réglée ne donnent pas un nouveau paiement |

Ces tests Solidity simulent les états attendus à l'entrée du coffre. Ils ne
prouvent ni la détection d'une facture piégée par une IA ni le fonctionnement
du relais ou du dashboard.

Le fuzz du marché (`testFuzz_commitReveal`) parcourt votes, motifs, empreintes
et sels. Celui du coffre (`testFuzz_Signature_quelconque_neConsommeRien`)
soumet des signatures arbitraires et vérifie l'absence de consommation.
Chacun est exécuté avec **256 runs**, lus dans `forge test --summary` et
`forge config --json`.

La campagne d'invariants du coffre effectue **256 runs**, profondeur **500**,
soit **128 000 appels** au handler dans cette mesure. Les cinq invariants
contrôlent le paiement unique par référence, la conservation des fonds, les
placements sous réserve, la couverture des montants bloqués et l'exactitude
des dettes admises. Le handler varie soumissions, approbations, refus,
expirations, approvisionnements, pauses et temps ; depuis le correctif M4, il
inscrit aussi de nouvelles factures et relève la réserve en cours de séquence. Sources :
`test/ArgentVault.t.sol:1266`, `:1409`, `forge config --json` et sortie
`ArgentVaultInvariantTest invariants` dans le journal du coffre.
Le marché n'a pas de suite `invariant_*`.

Les tests d'attaque du coffre tentent la réentrance depuis un bénéficiaire,
un relais autorisé malveillant et un approbateur malveillant. Ils vérifient
aussi le retour intégral à l'état précédent si le transfert natif échoue
(`test/ArgentVault.t.sol:990`). Le rejeu, le double paiement, la malléabilité
et la liaison de la signature à la chaîne et au contrat sont testés dans les
scénarios et les règles. Pour le marché, la liaison du commit au vérificateur,
les révélations incohérentes, la double saisie et le double retrait sont
testés dans `VerificationMarketTest`, `SlashingTest` et `RewardsTest`.

## Scène d'attaque sur le L1

`script/attack-scene.sh` comporte quatre constats. Le run AWS a terminé avec
une sortie 0 : [preuves/scene-aws.md](preuves/scene-aws.md).

| Constat | Ce que la scène lit ou vérifie |
|---|---|
| a. Accès à l'écriture | Une adresse hors TxAllowList est rejetée malgré son solde de gaz |
| b. Absence de commit | Saisie de 1 % et ajout d'un strike à la finalisation |
| c. Vote contraire au plafond | Contestation d'un Accept incohérent, saisie de 20 % |
| d. Lecture finale | Cautions, strikes, réputation et codes des demandes relus sur la chaîne |

Sources des taux : `src/Slashing.sol:30` ; déroulé : `script/attack-scene.sh`.
Cette scène concerne le marché et les accès du L1.

## Répétition du coffre sur un L1 local identique

ArgentVault est répété sur un L1 local identique au L1 de démo (chainId
191919, TxAllowList, Native Minter) : **20 transactions**, décisions 0, 1 et 2,
refus, expiration, rejeu, pause puis reprise, toutes relues par `cast`. Une
adresse non admise est refusée par le nœud à l'appel de `fund()`. Le coffre
n'est pas encore déployé sur le L1 de démo. Preuve :
[preuves/vault-l1-local.md](preuves/vault-l1-local.md) ; déroulé :
`script/DeployArgentVault.s.sol` et `script/RehearseArgentVault.s.sol`.

## Battement de blocs

`script/heartbeat.sh` envoie une transaction neutre à intervalle fixe pour que
le L1 produise des blocs pendant les fenêtres de la démo. Il échoue clairement
sans RPC ni admission, tourne pendant un bout en bout, s'arrête au Ctrl-C (code
0) et reprend après une coupure passagère :
[preuves/heartbeat-local.md](preuves/heartbeat-local.md).

## Hors chaîne

La suite de `offchain/` utilise `node:test` et des contrats sur anvil. Elle
couvre les empreintes, lectures signées, cache, passerelle, évaluateur factice,
services vérificateurs, reçus en échec, chaîne inactive et tirage.
**199 tests npm passent** (34 suites, 0 échec), mesurés par `npm test`
dans `offchain/` sur la révision intégrée.

`offchain/e2e.sh` lance le cache, la passerelle et les services vérificateurs
contre le L1. Il vérifie que le code est connu et que les reveals sont présents.
Il affiche les détails retournés, sans assertion sur leur nombre. Avec
`E2E_EXPECT_CLOSED=1`, il vérifie la clôture relue sur la chaîne et l'absence
de caution encore bloquée. Les runs local et
AWS passent, y compris deux demandes successives avec les mêmes services.
Sources : `offchain/e2e.sh`, [preuves/e2e-aws.md](preuves/e2e-aws.md) et
[preuves/e2e-aws-cache.md](preuves/e2e-aws-cache.md). Ces runs utilisent l'évaluateur factice et ne
comprennent pas ArgentVault.

## Commandes de lancement

Depuis la racine du dépôt, avec les dépendances installées :

| Suite | Une ligne |
|---|---|
| Foundry | `forge test` |
| Hors chaîne | `(cd offchain && npm test)` |
| Bout en bout sur L1 | `RPC_URL="$RPC_URL" ADDRESSES_FILE=deployments/latest-aws.json E2E_EXPECT_CLOSED=1 bash offchain/e2e.sh` |
| Scène d'attaque | `ADMIN_ACCOUNT="$ADMIN_ACCOUNT" bash script/attack-scene.sh "$RPC_URL"` |

Le RPC privé et le keystore administrateur sont renseignés dans l'environnement.
Les scripts L1 envoient des transactions ; la scène redéploie une pile.
Le fichier de déploiement doit correspondre au réseau visé.
Sources des commandes : `offchain/package.json`, `offchain/e2e.sh`,
`script/attack-scene.sh` et [rejouer-la-demo.md](rejouer-la-demo.md).
