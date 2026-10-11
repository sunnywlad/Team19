# Mesures de taille et de gaz

Nous avons mesuré les deux branches séparément, sans modifier le code :
`wladimir` à la révision `e1dfa06` pour le marché et `feat/argent-vault` à la
révision `cf7d1f3` pour le coffre. Les chiffres ci-dessous viennent de
`forge build --sizes`, `forge test --gas-report` et des tests ciblés indiqués.

Les sorties brutes sont conservées dans
`Team19-notes/logs/gas-report-marche.log` et
`Team19-notes/logs/gas-report-vault.log`. Ces journaux contiennent aussi les
sorties `forge test --summary` et `forge config --json`.

## Compilateur et méthode

| Réglage | Marché | Coffre | Source |
|---|---|---|---|
| Forge | 1.8.4 | 1.8.4 | `forge --version` |
| Solidity effectivement utilisé | 0.8.37 | 0.8.37 | Sorties de `forge build --sizes` |
| Optimiseur | Activé | Activé | `foundry.toml:5` |
| Runs de l'optimiseur | 200 | 200 | `foundry.toml:6` |
| Compilation via IR | Non | Non | `forge config --json`, `via_ir` |
| Cible EVM | Osaka | Osaka | `forge config --json`, `evm_version` |

Les fichiers `foundry.toml` ne fixent ni la version de Solidity ni la cible
EVM. Les valeurs effectivement utilisées ci-dessus rendent cette campagne
identifiable ; elles ne constituent pas une preuve de compatibilité de
chaque opcode avec le L1.

Dans le worktree du marché, les commandes utilisent la dépendance
`forge-std` existante en lecture, avec `--offline` et un remapping explicite.
Le build utilise aussi `--lib-paths` vers cette dépendance. Dans celui du
coffre, toutes les commandes Forge ajoutent
`--out /tmp/docs-out --cache-path /tmp/docs-cache` pour ne pas écrire
d'artefacts dans le worktree source.

Les coûts sont ceux des appels observés par Foundry dans son EVM de test.
Ils dépendent du chemin, de l'état, des accès déjà chauds et des doublures,
notamment celle du Native Minter. Les rapports globaux mêlent appels
réussis et chemins attendus en échec. Ils ne donnent ni un prix en VETO
ni le coût total d'une transaction ou d'un parcours sur le L1 AWS.
Nous ne les additionnons pas pour fabriquer un coût de demande.

## Tailles des contrats

La taille est celle du bytecode d'exécution, en octets. La marge est celle
affichée par `forge build --sizes` sous la limite de **24 576 octets**.
Les contrats déployables de `src/` figurent ci-dessous ; interfaces et base
abstraite n'ont pas de bytecode à déployer.

| Contrat | Marché : taille | Marché : marge | Coffre : taille | Coffre : marge |
|---|---:|---:|---:|---:|
| `VerificationMarket` | 7 399 | 17 177 | 7 399 | 17 177 |
| `StakedVerificationMarket` | 9 902 | 14 674 | 9 902 | 14 674 |
| `DrawnVerificationMarket` | 14 970 | 9 606 | 14 970 | 9 606 |
| `VerifierRegistry` | 5 335 | 19 241 | 5 335 | 19 241 |
| `Slashing` | 5 144 | 19 432 | 5 144 | 19 432 |
| `Rewards` | 2 058 | 22 518 | 2 058 | 22 518 |
| Guichet : `VetoDesk` / `ChkDesk` | 1 096 | 23 480 | 1 096 | 23 480 |
| `AgentIdentityRegistry` | 4 269 | 20 307 | 4 269 | 20 307 |
| `AgentReputationRegistry` | 4 591 | 19 985 | 4 591 | 19 985 |
| `AgentValidationRegistry` | 4 122 | 20 454 | 4 122 | 20 454 |
| `ArgentVault` | Absent | Sans objet | 10 555 | 14 021 |

Source : rubrique `Runtime Size (B)` et `Runtime Margin (B)` des deux builds.
La branche du coffre conserve le nom de contrat `ChkDesk` ; nous reprenons
ici ce nom exact pour identifier la mesure du guichet.

Les builds affichent également les doublures déployables des tests :

| Doublure | Marché : taille / marge | Coffre : taille / marge |
|---|---:|---:|
| `MockNativeMinter` | 883 / 23 693 | 883 / 23 693 |
| `RevertingReputation` | 290 / 24 286 | 290 / 24 286 |
| `RevertingValidation` | 363 / 24 213 | 363 / 24 213 |
| `MaliciousBeneficiary` | Absent | 726 / 23 850 |
| `ReentrantApprover` | Absent | 1 318 / 23 258 |
| `ReentrantRelay` | Absent | 2 506 / 22 070 |
| `RevertingReceiver` | Absent | 116 / 24 460 |

Source : mêmes sorties `forge build --sizes`. Ces doublures ne font pas partie
de la pile de démonstration.

## Parcours du marché

Source de toutes les cellules : `forge test --gas-report` sur la branche
`wladimir`, tableaux des contrats nommés dans `gas-report-marche.log`.
Les valeurs sont en unités de gaz ; la colonne appels compte les échantillons
du rapport, y compris ceux du fuzz.

| Contrat | Fonction | Minimum | Moyenne | Médiane | Maximum | Appels |
|---|---|---:|---:|---:|---:|---:|
| `VerificationMarket` | `createRequest` | 21 491 | 138 198 | 139 225 | 139 225 | 459 |
| `VerificationMarket` | `commitVerdict` | 24 300 | 73 391 | 73 765 | 73 859 | 637 |
| `VerificationMarket` | `revealVerdict` | 23 750 | 50 605 | 41 452 | 61 666 | 546 |
| `VerificationMarket` | `finalize` | 23 789 | 45 742 | 45 958 | 48 573 | 162 |
| `VerificationMarket` | `close` | 23 833 | 26 220 | 26 341 | 28 297 | 8 |
| `StakedVerificationMarket` | `createRequest` | 240 687 | 279 061 | 283 236 | 309 087 | 4 |
| `StakedVerificationMarket` | `commitVerdict` | 73 753 | 73 782 | 73 782 | 73 812 | 2 |
| `StakedVerificationMarket` | `revealVerdict` | 41 346 | 41 375 | 41 375 | 41 405 | 2 |
| `StakedVerificationMarket` | `finalize` | 424 582 | 424 582 | 424 582 | 424 582 | 1 |
| `StakedVerificationMarket` | `close` | 64 780 | 64 780 | 64 780 | 64 780 | 1 |
| `DrawnVerificationMarket` | `createRequest` | 141 056 | 154 247 | 158 156 | 158 156 | 35 |
| `DrawnVerificationMarket` | `drawCommittee` | 23 854 | 289 811 | 350 053 | 384 395 | 34 |
| `DrawnVerificationMarket` | `commitVerdict` | 31 406 | 78 908 | 80 400 | 80 447 | 33 |
| `DrawnVerificationMarket` | `revealVerdict` | 47 833 | 47 884 | 47 892 | 47 939 | 32 |
| `DrawnVerificationMarket` | `finalize` | 81 821 | 489 968 | 435 919 | 972 242 | 15 |
| `DrawnVerificationMarket` | `close` | 30 469 | 71 352 | 81 573 | 81 573 | 5 |
| `Slashing` | `contest` | 40 848 | 97 259 | 117 945 | 144 731 | 17 |
| `Slashing` | `slashMissed` | 39 051 | 108 739 | 138 974 | 154 624 | 11 |
| `VerifierRegistry` | `seize` | 24 190 | 67 979 | 78 918 | 78 940 | 5 |

Le tirage appartient au marché de phase 3. La contestation est portée par
`Slashing`. La saisie effective est portée par `VerifierRegistry.seize`, appelé
par `Slashing` ; son coût est déjà inclus dans l'appel parent lorsqu'il s'y
produit. Ces cellules ne sont donc pas des postes à additionner.
Sources du câblage : `src/DrawnVerificationMarket.sol:133`,
`src/Slashing.sol:122`, `src/Slashing.sol:162` et `src/VerifierRegistry.sol:188`.

## Parcours d'ArgentVault

### Mesures ciblées par décision

Pour séparer les décisions, chaque ligne vient d'un test existant lancé seul :
`forge test --gas-report --match-contract <suite> --match-test <test>`, avec
les options d'artefacts du coffre. La valeur provient de la ligne de fonction
du rapport, pas du coût global du test. Chaque fonction indiquée a **un appel
mesuré** dans son test ; minimum, moyenne, médiane et maximum y sont égaux.

| Fonction et issue | Gaz mesuré | Suite | Test source dans `test/ArgentVault.t.sol` |
|---|---:|---|---|
| `submit`, décision 0 : facture inconnue | 70 896 | `ArgentVaultScenariosTest` | `test_Scenario4_FacturePiegeeNonDetectee` |
| `submit`, décision 1 : facture au-dessus du seuil | 192 487 | `ArgentVaultScenariosTest` | `test_Scenario6_MontantAuDessusDuSeuil` |
| `submit`, décision 2 : facture payée immédiatement | 127 038 | `ArgentVaultScenariosTest` | `test_Scenario1_FactureLegitime` |
| `approve`, paiement à l'échéance incluse | 115 662 | `ArgentVaultScenariosTest` | `test_Scenario6a_ApprobationAvantEcheance` |
| `refuse`, refus humain et libération du montant | 63 002 | `ArgentVaultCase1AndPauseTest` | `test_Cas1_refusExplicite_APPROVAL_REFUSED` |
| `expire`, délai dépassé et libération du montant | 63 107 | `ArgentVaultScenariosTest` | `test_Scenario6b_ExpirationSansReponse` |

Source : six rapports ciblés annexés à `gas-report-vault.log`. Le refus mesuré
est celui d'une facture inconnue, pas un coût universel de décision 0.
Les autres motifs, placements, transferts vers des contrats et approbations
tardives empruntent d'autres chemins.

### Rapport global du coffre

La suite complète, incluant fuzz et campagne d'invariants, donne aussi :

| Fonction | Minimum | Moyenne | Médiane | Maximum | Appels |
|---|---:|---:|---:|---:|---:|
| `submit` | 31 060 | 58 669 | 65 488 | 219 311 | 18 636 |
| `approve` | 27 046 | 101 017 | 115 656 | 115 662 | 148 |
| `refuse` | 27 003 | 62 622 | 63 002 | 68 094 | 252 |
| `expire` | 35 907 | 62 919 | 63 107 | 68 199 | 73 |

Source : tableau `src/ArgentVault.sol:ArgentVault Contract` du rapport complet
`forge test --gas-report`, avant les annexes ciblées. La moyenne de `submit`
mélange les décisions et les états explorés ; elle ne décrit pas un paiement.

## Choix du code liés au gaz

Nous n'avons pas mené de campagne d'optimisation avec mesures avant/après.
Nous ne revendiquons aucun gain chiffré. Les choix observables suivants
limitent des lectures, des copies, des écritures ou des déplacements :

| Choix visible | Code source | Effet recherché, sans gain mesuré |
|---|---|---|
| Configuration `immutable` | Marché, `src/VerificationMarket.sol:29`, `src/Rewards.sol:34` ; coffre, `src/ArgentVault.sol:53` | Rôles et paramètres fixes portés par le bytecode, sans lecture d'une case de stockage pour ces valeurs |
| Champs courts regroupés | Marché, `src/interfaces/IVerificationMarket.sol:40` et `:52` ; coffre, `src/ArgentVault.sol:73`, `:79` et `:99` | Regroupement des horodatages, statuts, motifs et drapeaux en stockage |
| Entrées en `calldata` | Marché, `src/Rewards.sol:78`, `src/Slashing.sol:162` ; coffre, `src/ArgentVault.sol:160` et `:550` | Lecture des entrées sans copie complète systématique en mémoire |
| Références de stockage et valeurs locales | Marché, `src/VerificationMarket.sol:72`, `src/DrawnVerificationMarket.sol:159` ; coffre, `src/ArgentVault.sol:181` et `:474` | Accès directs aux structures et réemploi de valeurs déjà lues |
| Retrait de la liste active par échange avec le dernier élément | Marché, `src/VerifierRegistry.sol:248` | Suppression sans décalage de tous les membres suivants |
| Fisher-Yates partiel du comité | Marché, `src/DrawnVerificationMarket.sol:185` | Sélection de trois membres sans mélanger toute la liste ; le filtrage des éligibles reste une boucle sur les inscrits |
| Erreurs personnalisées | Marché, `src/VetoDesk.sol:15` ; coffre, `src/ArgentVault.sol:47` | Signalement par sélecteur et arguments typés plutôt que chaînes de refus |
| Empreintes constantes du domaine et de la demande | Coffre, `src/ArgentVault.sol:23` | Valeurs fixes exprimées en constantes ; le séparateur de domaine reste recalculé à chaque appel |

Les chemins « Marché » désignent `wladimir`, les chemins « Coffre » désignent
`feat/argent-vault`. Ces observations décrivent le code mesuré. Elles ne
quantifient pas l'effet isolé de chacun de ces choix.
