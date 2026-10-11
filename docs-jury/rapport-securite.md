# Rapport de sécurité

## Résumé

Nous avons revu le marché de vérification, ses cautions, sanctions, récompenses, VetoDesk, les trois registres ERC-8004 adaptés, ArgentVault et la configuration du L1.
Commits audités : wladimir **e1dfa06b00d4052807268d8340141dd402baec5d** ; feat/argent-vault **cf7d1f367660796b0216ee79912643d8d592d16f**. Outils : Forge 1.8.4, solc 0.8.37, Slither 0.11.6, 102 détecteurs, lecture manuelle des sources, tests, scripts, specs et questions jury.
Verdict : tests verts, mais **1 constat haut, 5 moyens, 7 bas et 2 informatifs**. Les clés publiques limitent la démo ; l'approbation d'un placement peut contourner une réserve modifiée après sa mise en attente. Nous ne concluons pas à une aptitude à la production.

Il s'agit d'une revue interne, pas d'un audit externe.

## Périmètre et preuves

Les références du marché et du L1 renvoient au commit wladimir cité. Les références à src/ArgentVault.sol, test/ArgentVault.t.sol et script/DeployArgentVault.s.sol renvoient au commit feat/argent-vault cité. Le coffre n'est pas intégré à wladimir à cette révision ; sa sécurité locale est examinée séparément.

L'exécution du marché portait initialement sur 88fbb16a22b49393a09b521a9aaaf8e146f3357b. Entre ce commit et e1dfa06, seul offchain/DESIGN.md change. Nous avons relu cette modification : contrats, tests, scripts, specs et configuration L1 sont identiques.

Nous avons exécuté :

    forge test
    slither . --filter-paths "lib/|test/|script/"

Pour le coffre, Forge a utilisé une sortie et un cache temporaires distincts. Slither a analysé une copie temporaire du worktree, sans .git. La bibliothèque forge-std existante a été référencée en lecture seule pour le marché : le worktree neuf avait un sous-module vide, et la tentative automatique de téléchargement a échoué avant la compilation réussie.

Les alertes Slither sont extraites dans docs-jury/preuves/slither-marche.md et docs-jury/preuves/slither-vault.md. Résultats : 36 alertes sur le marché, 57 sur la branche du coffre, dont 36 communes et 21 propres à ArgentVault. Le code de sortie 255 de Slither correspond ici à des alertes trouvées ; les deux analyses se sont achevées.

La configuration L1 est revue manuellement : Slither n'analyse ni une genèse JSON ni validatorOnly. Les précompilés sont appelés par interface ; leur implémentation Subnet-EVM et les contrats préalloués en bytecode dans la genèse ne sont pas audités en source. Les preuves d'accès au réseau restent celles des contrôles historiques lus.

Nous avons lu les preuves historiques de la scène dans docs-jury/preuves/scene-aws.md. Les contrôles réseau du L1 (validatorOnly, RPC lié à l'interface locale) ont été faits à la mise en place du nœud ; nous en avons relu le compte rendu, sans les rejouer. Nous n'avons rejoué ni déploiement ni scène sur le réseau pendant cette revue. Les tests hors chaîne ne sont pas réexécutés ici.

### Tests mesurés par fichier

| Fichier | wladimir | feat/argent-vault |
|---|---:|---:|
| test/VerificationMarket.t.sol | 65 | 65 |
| test/VerifierRegistry.t.sol | 37 | 37 |
| test/Slashing.t.sol | 29 | 29 |
| test/Rewards.t.sol | 15 | 15 |
| test/VetoDesk.t.sol | 12 | absent |
| test/ChkDesk.t.sol | absent | 12 |
| test/Phase2.t.sol | 3 | 3 |
| test/DrawnVerificationMarket.t.sol | 21 | 21 |
| test/Phase3.t.sol | 12 | 12 |
| test/erc8004/AgentIdentityRegistry.t.sol | 21 | 21 |
| test/erc8004/AgentReputationRegistry.t.sol | 19 | 19 |
| test/erc8004/AgentValidationRegistry.t.sol | 19 | 19 |
| test/ArgentVault.t.sol | absent | 77 |
| **Total, aucun échec ni test ignoré** | **253** | **330** |

Les 77 tests du coffre se répartissent en 12 scénarios, 20 tests de rôles, 22 de règles, 10 de cas humains et pauses, 5 de réentrance/transfert, 7 de vecteurs, et une campagne regroupant cinq invariants. Cette campagne a effectué 256 séquences de profondeur 500, soit 128 000 appels et zéro revert. Les cinq propriétés sont vérifiées ensemble, elles ne comptent pas comme cinq tests supplémentaires dans le total Forge.

Cette campagne appelle submit, approve, refuse, expire, fund, togglePause et warp. Elle ne fait varier ni les dettes admises par de nouvelles inscriptions, ni la réserve en cours de séquence. Son résultat ne couvre donc pas M4.

## Modèle de menace

| Acteur | Ce qu'il peut faire | Ce que les contrôles lui interdisent, ou limite de la preuve |
|---|---|---|
| Demandeur du marché | Payer une demande, choisir H, multiplier les demandes, appeler tirage/finalisation/clôture et contester avec les faits. | Ne peut révéler comme un autre membre sans sa clé. Son adresse est exclue du comité tiré, mais les identités collusives et les clés publiques restent une limite. Aucun contrat du marché ne force son action hors chaîne. |
| Vérificateur | S'inscrire s'il est admis, déposer/recharger sa caution, voter s'il siège, rester muet, sortir quand rien n'est verrouillé. | Ne peut changer un verdict déjà engagé sans échec de reveal. Ne peut retirer une caution verrouillée. Deux membres collusifs peuvent toutefois produire deux Accept ; le quorum n'exige pas trois réponses. |
| Agent IA du client | Proposer une action et une référence du coffre dans un mandat inscrit. | ArgentVault ne lui permet pas de fournir un nouveau montant ou bénéficiaire à submit. Le contrat authentifie la clé client, pas la qualité du raisonnement de l'agent. |
| Signataire client | Signer une Request liant client, agent, action, référence, dates et identifiant. | Sa signature seule ne permet pas de transmettre directement submit s'il n'est pas le relais. Le coffre ne vérifie pas qu'une facture inscrite est vraie. |
| Relais | Transmettre les demandes signées, retarder ou censurer leur transmission, soumettre des demandes déjà signées pendant une pause. | Ne peut fabriquer une signature valide du client ni changer les champs signés. Une signature invalide ne brûle pas l'identifiant. Une demande valide refusée pour raison métier est consommée. |
| Admin du L1 et admins applicatifs | L'admin réseau gère admission et frappe. Les admins des contrats câblent les dépendances ; l'admin Slashing change les prédicats ; celui de VetoDesk autorise des opérateurs. | Ces rôles sont contrôlés par adresse, sans multisignature démontrée. Le Native Minter n'a pas de plafond global dans la configuration lue. Le validateur peut arrêter/censurer la chaîne et influer sur le bloc d'aléa. |
| Propriétaire du coffre | Inscrire les agents, fixer seuil/réserve/délai, lever les pauses. | Ne peut retirer librement, inscrire seul une facture ou appeler approve. Les rôles et le signataire sont six adresses distinctes et immuables, sans preuve qu'elles appartiennent à six opérateurs indépendants. |
| Admission du coffre | Inscrire bénéficiaires, factures et placements ; annuler une facture Admitted. | Ne peut payer seule. Une facture Held ne peut être annulée. Elle peut néanmoins inscrire une fausse dette ou augmenter les engagements après un hold. |
| Approbateur et gardien | L'approbateur clôt les cas humains ; le gardien bloque le coffre ou un agent connu. | L'approbateur ne modifie pas montant/destination. Le gardien ne reprend pas et ne paie pas. Refuse et expire restent utilisables en pause. |
| Intrus hors TxAllowList | Peut connaître le code et tenter d'accéder au RPC ; détenir du gaz ne lui donne pas le droit d'écrire. | Sa transaction propre est refusée par le nœud dans la scène lue. S'il atteint le RPC et utilise une clé de démo publiquement connue déjà admise, il usurpe ce compte : la liste ne distingue pas son détenteur légitime. |

Sources : src/VerificationMarket.sol:60, :92, :110, :137, :197 ; src/DrawnVerificationMarket.sol:168 ; src/VerifierRegistry.sol:97, :114, :126 ; src/Slashing.sol:100 ; src/VetoDesk.sol:49 ; src/ArgentVault.sol:138, :160, :208, :250, :285, :333 ; infra/l1/README.md:13.

## Garde-fous

« Prouvé par un test » désigne la propriété précise exercée dans l'EVM de Forge. « Prouvé par la scène » désigne la sortie historique lue. « Conçu » désigne une propriété déduite du code sans exercice ciblé. « Non couvert » désigne une affirmation plus large que les essais disponibles.

| Garde-fou | Contrat:ligne | Test qui le prouve | Statut |
|---|---|---|---|
| Membres seuls pour commit et reveal | VerificationMarket.sol:95, :113 | VerificationMarket.t.sol : test_commit_notMemberReverts, test_reveal_notMemberReverts | Prouvé par un test |
| Commit lié à la chaîne, au marché, à la demande, au membre et au verdict | VerificationMarket.sol:269 | test_commitmentOf_matchesLocal, test_reveal_commitmentForAnotherVerifierReverts et tests mismatchVote/Reasons/DetailHash/Salt | Prouvé par un test ; copie inter-chaînes non exercée spécifiquement |
| Frontières Commit/Reveal/Closed | VerificationMarket.sol:119, :203, :281 | test_commit_atDeadlineRejected, test_reveal_atDeadlineRejected, test_close_atDeadlineAccepted | Prouvé par un test |
| Quorum et agrégation 0/1/2 | VerificationMarket.sol:173 | test_finalize_aggregationExhaustive | Prouvé par un test |
| Finalisation malgré membre muet | VerificationMarket.sol:154 ; Slashing.sol:131 | test_finalize_afterDeadlineTwoReveals ; Slashing.t.sol : test_slashMissed_noCommitOnePercent | Prouvé par un test ; scène-aws.log:56 et :64 |
| Tirage de trois membres distincts, actifs, avec caution libre, hors demandeur | DrawnVerificationMarket.sol:166, :185 | DrawnVerificationMarket.t.sol : test_draw_committeeThreeDistinctEligible, test_draw_requesterNeverDrawn, test_draw_inactiveNeverDrawn, test_draw_noFreeStakeNeverDrawn | Prouvé par un test |
| H fixé avant le bloc d'aléa, tirage différé, reprogrammation après 256 blocs | DrawnVerificationMarket.sol:107, :142, :145 | test_draw_tooEarly_atDrawBlock, test_draw_reschedulesPast256_thenSucceeds | Prouvé par un test ; résistance générale au biais non couverte |
| Admission, verrou et saisie réservés aux rôles attendus | VerifierRegistry.sol:67, :115, :147, :176 | VerifierRegistry.t.sol : test_admit_onlyAdmin, test_register_notAdmittedReverts, test_lockStake_onlyMarket, test_seize_onlySlashing | Prouvé par un test |
| Pas de retrait de caution verrouillée ; libération par close | VerifierRegistry.sol:128 ; DrawnVerificationMarket.sol:337 | test_exit_lockedReverts, test_exit_allowedAfterUnlock ; test_endToEnd_drawRevealFinalizeClose | Prouvé par un test ; disponibilité automatique non couverte |
| Saisie unique, faits liés à H et fenêtre de contestation | Slashing.sol:126, :166, :170, :187 | Slashing.t.sol : test_contest_hashMismatchReverts, test_contest_alreadySlashedReverts, test_contest_windowClosedAtDeadline | Prouvé par un test |
| Saisies de 1 %, 5 %, 20 % plafonnées au verrou | VerifierRegistry.sol:189 ; Slashing.sol:32 | test_seize_fractionOnePercent, test_seize_fractionFivePercent, test_seize_boundedByLocked ; test_contest_twentyPercentAmount | Prouvé par un test aux montants testés ; arrondis minuscules non couverts |
| Frais en retrait, crédit consommé avant transfert, reste au trésor | Rewards.sol:88, :119 | Rewards.t.sol : test_distribute_remainderToTreasury, test_claim_twiceSecondReverts | Prouvé par un test ; rappel hostile sur claim non couvert |
| VetoDesk : opérateur seul, référence de crédit non rejouable | VetoDesk.sol:60, :63, :65 | VetoDesk.t.sol : test_credit_notOperatorReverts, test_credit_replayedRefReverts | Prouvé par un test, Native Minter simulé |
| ERC-8004 : identité non transférable, mutations réservées au propriétaire, réponse au validateur désigné | erc8004/AgentIdentityRegistry.sol:14 ; erc8004/AgentValidationRegistry.sol:102, :123 | AgentIdentityRegistry.t.sol : test_transferFrom_reverts, test_setMetadata_revertsNotOwner ; AgentValidationRegistry.t.sol : test_validationResponse_revertsNotValidator | Prouvé par un test local ; conformité externe non couverte |
| Notifications ERC-8004 isolées de finalize | DrawnVerificationMarket.sol:278 | Phase3.t.sol : test_finalize_okWhenReputationReverts, test_finalize_okWhenValidationReverts | Prouvé par un test de revert ; panne arbitraire consommant tout le gaz non couverte |
| Six adresses non nulles et distinctes au coffre | ArgentVault.sol:138 | ArgentVault.t.sol : test_Constructor_collisionDeRoles, test_Constructor_adresseOuIdentifiantNuls | Prouvé par des exemples de test ; boucle générale lue dans le code |
| Signature EIP-712 complète, domaine lié à chaîne et contrat, s bas et v canonique | ArgentVault.sol:440, :445, :550 | test_Vecteurs_domaineEtEmpreintes, test_Vecteurs_adresseRecupereeAttendue, test_Signature_domaineLieAuContratEtALaChaine, test_Signature_malleable_rejetee_nonConsommee | Prouvé par un test |
| Signature invalide avant consommation de requestId | ArgentVault.sol:168, :174 | test_Signature_malleable_rejetee_nonConsommee, testFuzz_Signature_quelconque_neConsommeRien | Prouvé par un test |
| Rejeu et double règlement refusés | ArgentVault.sol:172, :487, :525 | test_Scenario8a_Rejeu, test_Scenario8b_DoublePaiement, test_Cas1_approbationNePaieJamaisDeuxFois | Prouvé par un test |
| Verrou manuel Reentrancy et état de règlement avant transfert | ArgentVault.sol:109, :194, :221 | test_Reentrance_relaisMalveillant_bloqueParLeVerrou, test_Reentrance_approbateurMalveillant_neRepaiePas | Prouvé par un test |
| Transfert échoué annule consommation, règlement et hold libéré | ArgentVault.sol:198, :230 | test_TransfertEnEchec_submit_toutEstAnnule, test_TransfertEnEchec_approve_toutEstAnnule | Prouvé par un test sur l'état ; disparition des logs déduite du revert EVM |
| Plaçable limité par dettes, réserve et placements Held | ArgentVault.sol:384, :491 | test_Scenario7_PlacementTropEleve, test_Cas1_placementBloque_heldPlacements ; invariant_I3_PlacementSousReserve | Prouvé dans les séquences testées ; mutation des engagements pendant hold non couverte, M4 |
| Pause interdit les paiements ; reprise propriétaire ; libération sans paiement reste possible | ArgentVault.sol:211, :238, :313, :340 | test_Pause_coffre_aucuneSortie_seulProprietaireReprend, test_Cas1_approbationAgentEnPause_echoue_expirePossible | Prouvé par un test |
| Aucun retrait libre du coffre | ArgentVault.sol:160, :208 ; IArgentVault.sol:208 | Lecture exhaustive de l'interface et de l'implémentation ; test_Fund_montantNulEtEnvoiDirect pour l'envoi direct | Conçu, absence de fonction constatée |
| Transaction d'une adresse extérieure refusée | infra/l1/fuji/genesis-fuji.json:30 | docs-jury/preuves/scene-aws.md, étape (a), adresse financée puis rejetée | Prouvé par la scène historique |
| Synchronisation réservée aux validateurs | infra/l1/fuji/subnet-config.json:2 | Contrôle à la mise en place : un nœud observateur non validateur reste non synchronisé ; contre-épreuve locale avec validatorOnly désactivé | Prouvé par les contrôles historiques lus |
| RPC lié à l'interface locale, accès par tunnel | infra/l1/fuji/node-validator.json:11 ; infra/l1/README.md:16 | Contrôle à la mise en place : RPC écouté sur 127.0.0.1 seulement, port RPC jamais ouvert dans le pare-feu | Prouvé par les contrôles historiques ; intrusion complète non couverte |

## Constats

Les gravités expriment l'effet sur les propriétés annoncées, avec les préconditions précisées. « Accepté » signifie que nous retenons explicitement cette limite pour le prototype de démonstration, sans validation pour la production. Aucun défaut n'a été corrigé pendant cette revue.

### H1. Haute : clés publiques admises sur le L1 de démo

Un acteur capable d'atteindre le RPC peut signer comme les comptes de démo déjà admis. Il peut usurper demandeur et vérificateurs, déplacer leurs jetons disponibles et produire leurs votes. La TxAllowList protège les adresses, pas le secret des clés. Le contrôle réseau limite l'accès, sans restaurer l'indépendance des identités.

Preuves : script/deploy-all.sh:96 et :175 ; script/attack-scene.sh:20 ; docs-jury/preuves/scene-aws.md, comptes de test admis aux index 1 à 4. La genèse Fuji remplace l'admin de test public, mais le déploiement admet ensuite les comptes de test.

Statut : **accepté**, uniquement pour un réseau de test à accès restreint et des fonds de démo. Des identités secrètes et distinctes seraient nécessaires pour un usage réel.

### M1. Moyenne : tirage prévisible après le bloc d'aléa, pool non figé

Le hash de bloc est produit par notre validateur. L'éligibilité est lue au tirage, après que ce hash est connu : l'admin du registre peut changer l'admission ; les vérificateurs peuvent sortir ou recharger ; des missions concurrentes peuvent changer la caution libre. Le demandeur peut payer plusieurs demandes et choisir lesquelles faire tirer ; aucune preuve ne borne ce choix sélectif. H fixé avant le bloc ne suffit pas à prouver qu'il ne peut jamais viser un comité.

Preuves : src/DrawnVerificationMarket.sol:107, :155, :158, :172, :177 et :189. Les tests test_draw_differentBlockhashVariesCommittee et test_draw_coverageAllFiveOver200 imposent des hashes, sans mesurer un adversaire adaptant le pool ni le coût des essais répétés.

Statut : **accepté** pour la démo à validateur et admission de confiance. La résistance générale à la manipulation reste non couverte ; l'affirmation absolue des docs est à retirer.

### M2. Moyenne : progression et caution dépendent d'appels actifs

Une fenêtre écoulée ne déclenche aucun appel automatiquement. Sans transaction, les lectures du dernier bloc gardent un timestamp ancien ; une estimation de gaz peut donc refuser prématurément un appel qui serait valide dans un nouveau bloc. Les verrous restent jusqu'à close. À caution inchangée et lockBps = 2000, cinq missions simultanées peuvent épuiser la caution libre. Un demandeur admis peut saturer ce budget pendant les fenêtres en payant les frais ; sans finaliseur actif, le blocage se prolonge.

Preuves : src/VerificationMarket.sol:137, :197, :281 ; src/VerifierRegistry.sol:128, :154 ; src/DrawnVerificationMarket.sol:337 ; test/DrawnVerificationMarket.t.sol:365. La scène termine avec des cautions encore verrouillées, docs-jury/preuves/scene-aws.md, étape (d).

Statut : **ouvert**. Finalize et close sont accessibles à tous, ce qui permet la récupération après les délais, mais aucune continuité du service de clôture n'est prouvée. Les services existants réalisent les appels dans les cycles lus ; cela ne garantit pas leur disponibilité permanente.

### M3. Moyenne : prédicats de sanction modifiables après le verdict

Le plafond et la liste des bénéficiaires ne sont ni versionnés ni figés par demande. Une décision correcte lors du reveal peut devenir fautive au moment de contest si l'admin change la politique ; l'inverse peut faire disparaître une faute. La saisie conserve alors la forme d'une preuve sur H, mais évalue une politique différente. La contestation ne recalcule pas le code final du marché.

Preuves : src/Slashing.sol:100, :105, :110, :177 et :191 ; src/VerificationMarket.sol:189. Les tests prouvent les sanctions à politique fixée, sans séquence de changement de politique pendant une mission.

Statut : **accepté** sous l'hypothèse d'admin de confiance et de politique stable pendant les missions de démo. La protection contre une modification rétroactive n'est pas conçue dans le code actuel.

### M4. Moyenne : approve peut payer un placement devenu incompatible avec la réserve

Submit contrôle le plaçable puis réserve le placement. Pendant l'attente, l'admission peut ajouter une dette et le propriétaire peut augmenter la réserve. Approve vérifie rôle, pause et échéance, puis paie sans revalider la couverture actuelle des dettes et de la réserve.

Contre-exemple déduit du code, non exécuté : cash 100, dettes 20, réserve 10, seuil 0 ; un placement de 60 est retenu pour approbation car le plaçable vaut 70. Une nouvelle facture de 20 porte les dettes à 40. Approve verse 60 et laisse cash 40, inférieur à dettes 40 + réserve 10. Une hausse de réserve produit le même type de défaut.

Preuves : src/ArgentVault.sol:182, :208, :219, :259, :294, :384 et :498 ; specs/02-contrat.md:110 ; specs/acceptance/scenarios.md:232. Le handler de test n'ajoute pas de dette et ne change pas la réserve pendant ses séquences, test/ArgentVault.t.sol:1311 et :1409.

Statut : **ouvert**. Les 77 tests verts ne démontrent pas I3 dans cette situation. Une future règle devra préciser la revalidation ou les mutations permises des engagements pendant un hold.

### M5. Moyenne : dépendances externes susceptibles de bloquer finalize

Les saisies transfèrent immédiatement au trésor. Si ce destinataire contractuel refuse le transfert, finalize d'une demande avec absent échoue et les verrous ne peuvent atteindre close. Si Rewards perd son autorisation Native Minter alors que bonus > 0, la frappe peut également faire échouer la finalisation avec reveals. Ces appels ne sont pas isolés comme les notifications ERC-8004.

Le registre applique ses effets avant le transfert, mais le trésor reçoit la main avant l'ajout du strike dans Slashing. Une trésorerie contractuelle hostile pourrait rappeler d'autres fonctions permissionless, modifier l'ordre des événements ou provoquer un revert. Aucun exploit de vol ni essai de ce callback n'est exécuté ici.

Preuves : src/VerifierRegistry.sol:209 et :210 ; src/Slashing.sol:142 et :147 ; src/Rewards.sol:102 et :106 ; src/DrawnVerificationMarket.sol:242 et :262 ; script/DeployPhase3.s.sol:91. Les scripts choisissent le déployeur comme trésor et autorisent Rewards à frapper, script/deploy-all.sh:283.

Statut : **accepté** pour la démo sous trésor EOA de confiance et droits Native Minter maintenus. L'absence de blocage face à une trésorerie arbitraire ou à une révocation de frappe reste non couverte.

### B1. Basse : exclusion annoncée pour dix demandes, borne effective différente

Avec count = 3 et exclusionRequests = 10, struckUntil vaut 13. Le tirage exclut requestId < 13 : les neuf demandes futures 4 à 12 sont exclues, 13 ne l'est plus. Des demandes payées sans tirage font avancer count et raccourcissent la durée effective ; ce n'est pas une durée calendaire.

Preuves : src/Slashing.sol:216 ; src/DrawnVerificationMarket.sol:172 ; src/VerificationMarket.sol:65 ; docs-jury/fautes.md:33 ; test/Slashing.t.sol:272.

Statut : **ouvert**, contradiction déjà relevée par la question jury 18. Le test couvre la borne stockée, pas dix demandes futures exclues.

### B2. Basse : initialisation des registres ERC-8004 ouverte au premier appelant

Un compte admis peut appeler initialize avant le déployeur et fixer irréversiblement une mauvaise identité de référence. Le script diffuse création et initialisation comme plusieurs transactions ; leur voisinage dans le script ne rend pas l'ensemble atomique. L'effet porte sur réputation/validation ; finalize est prévu pour tolérer leur échec.

Preuves : src/erc8004/AgentReputationRegistry.sol:86 ; src/erc8004/AgentValidationRegistry.sol:77 ; script/DeployPhase3.s.sol:111 et :114. Les tests vérifient l'initialisation unique, pas l'identité de l'initialisateur.

Statut : **ouvert**, conditionnel à une intervention avant initialize. Aucun front-running de déploiement n'a été reproduit.

### B3. Basse : pourcentages plafonnés, arrondis et paramètres non bornés

Une saisie vaut min(floor(total courant × bps / 10000), verrou restant). Elle peut donc être inférieure au taux annoncé : poussière arrondie à zéro, verrou déjà plus faible ou recharge après verrouillage. Pour total = 99 wei, 1 % vaut zéro ; 20 % vaut 19 wei. Ces exemples sont des calculs de la formule, pas des mesures réseau. Une recharge augmente le total courant sans rehausser les verrous existants.

Le constructeur accepte notamment minStake = 0 et lockBps = 0 ; lockBps > 10000 rend généralement le verrou impossible. Les conversions uint16/uint8 des scripts peuvent tronquer une valeur d'environnement trop grande. Les montants de démo évitent la poussière ; les tests couvrent la saisie plafonnée.

Preuves : src/VerifierRegistry.sol:58, :120, :154 et :189 ; src/Slashing.sol:74 ; script/DeployPhase3.s.sol:43 ; test/VerifierRegistry.t.sol:169 et :344.

Statut : **accepté** pour les paramètres nominaux lus : minStake 100 unités natives, lockBps 2000, strikeLimit 3. Les taux sont une règle plafonnée, sans calibration économique démontrée.

### B4. Basse : fonds captifs

Le marché de phase 1 n'a aucun retrait des frais ni remboursement du surplus envoyé à createRequest. Dans ArgentVault, aucun retrait libre n'existe : un dépôt erroné ne ressort que par un règlement inscrit et autorisé. Une ancienne pile conserve ses cautions tant que ses missions ne sont pas clôturées ; redéployer ne les migre pas.

Preuves : src/VerificationMarket.sol:11, :62 et :78 ; src/ArgentVault.sol:354 ; specs/02-contrat.md:265. Une répétition peut échouer après deux redéploiements réussis si l'ancienne pile garde des cautions verrouillées.

Statut : **accepté** pour des fonds de test. La récupération des dépôts erronés et la migration des anciennes piles restent non couvertes.

### B5. Basse : aucune rotation des rôles et du signataire du coffre

Les six adresses sont immuables. Une clé perdue peut immobiliser le flux ; une clé compromise conserve son rôle. Le redéploiement indiqué par la spec ne fournit pas une migration automatique des fonds, registres et demandes en attente. La distinction des six adresses ne démontre pas leur indépendance opérationnelle.

Preuves : src/ArgentVault.sol:53 et :138 ; specs/02-contrat.md:51 ; script/DeployArgentVault.s.sol:52.

Statut : **accepté** pour la démo. Rotation, reprise et migration restent hors de l'implémentation.

### B6. Basse : validation avec adresse nulle et réponse révisable

ValidationRequest ne rejette pas validatorAddress nul alors que ce champ sert de sentinelle d'inexistence. Une telle entrée ne peut recevoir de réponse et n'empêche pas une nouvelle demande sous le même hash. Les tableaux historiques peuvent alors contenir plusieurs fois ce hash et biaiser un agrégat si la dernière entrée finit par être répondue. Le validateur désigné peut aussi remplacer une réponse existante, sans contrôle responded.

Preuves : src/erc8004/AgentValidationRegistry.sol:103, :105, :107, :122, :126 et :156. Aucun test de validateur nul, duplication consécutive ou réponse répétée n'est présent dans les 19 tests lus.

Statut : **ouvert**. Cette faiblesse concerne les registres consultatifs, sans accès supplémentaire aux fonds du coffre.

### B7. Basse : croissance du pool sans plafond

Le pool retourné par activeVerifiers inclut les inscrits à filtrer et n'a pas de plafond dans le code. Le tirage copie puis parcourt toute cette liste avec des appels externes. Des inscrits devenus inactifs y restent jusqu'à leur sortie. Le coût peut dépasser le budget de gaz d'un bloc si la liste devient trop grande ; aucun seuil de saturation n'est mesuré.

Preuves : src/VerifierRegistry.sol:104, :120, :223 ; src/DrawnVerificationMarket.sol:158 et :166 ; infra/l1/fuji/genesis-fuji.json:11.

Statut : **accepté** pour un petit pool admis par l'admin en démo. La capacité maximale et la gestion d'un pool durable restent non couvertes.

### I1. Info : émission et paiement hors chaîne reposent sur la confiance

VetoDesk vérifie opérateur, montant positif et unicité de paymentRef. Il ne prouve pas un encaissement hors chaîne et ne plafonne pas l'émission. Rewards récompense un reveal valide, pas la vérité du verdict ; le bonus est frappé avant la fin de contestation. Une contestation ne corrige ni code final ni score de participation.

Preuves : src/VetoDesk.sol:59 ; src/Rewards.sol:102 ; src/DrawnVerificationMarket.sol:313 ; src/Slashing.sol:191.

Statut : **accepté**, séparation explicite entre contrôle déterministe, jugement et preuve d'encaissement.

### I2. Info : affirmations documentaires plus larges que les preuves

Nous reprenons les questions jury 6 à 21 et 30 à 35, et leur tableau final de requalifications. Les points suivants restent à expliciter dans les documents de présentation :

| Source | Contradiction ou portée réelle |
|---|---|
| docs-jury/architecture.md:64 ; flux-demande.md:17 | L'évaluateur configuré est factice, offchain/DESIGN.md:61 et :99 ; aucun jugement LLM réel n'est prouvé ici. |
| docs-jury/fautes.md:39 | Injection de canaris et indiscernabilité affirmées, sans preuve d'exécution lue. |
| docs-jury/fautes.md:51 et :64 | Non-manipulation absolue du tirage et tolérance à la dérive temporelle non mesurées, M1 et M2. |
| docs-jury/fautes.md:33 | Dix demandes d'exclusion annoncées, borne stricte donnant neuf futures demandes dans l'exemple séquentiel, B1. |
| docs-jury/architecture.md:57 | H seul décrit le contenu initial ; contest publie Facts et contentHash, Slashing.sol:157 ; les reveals exposent votes et motifs. |
| docs-jury/architecture.md:62 | Le tunnel permet aussi des clients RPC directs. La passerelle n'est pas l'unique voie pour un acteur ayant cet accès. |
| docs-jury/architecture.md:50 | Registres adaptés localement, sans preuve d'interopérabilité ERC-8004 complète ; signatures ABI et événements sont adaptés dans les NatSpec. |
| docs-jury/architecture.md:13 | warpConfig est présent ; la nécessité alléguée pour le run n'est pas démontrée par un essai comparatif. |
| specs/02-contrat.md:51 | Cinq rôles distincts sont décrits ; le code impose aussi que clientSigner soit différent, soit six adresses. |
| specs/acceptance/scenarios.md:281 | « Aucune action automatique ne déplace de fonds » ne décrit pas le mode natif : submit sous le seuil paie immédiatement. Dans la production envisagée, Paid serait une autorisation de virement ; le connecteur n'est pas construit. |

Statut : **ouvert** pour les formulations encore présentes aux commits cités. Nous ne modifions pas ces fichiers pendant la revue. Les notes historiques peuvent citer d'anciens numéros de ligne ; les références de contrats de ce rapport visent les révisions auditées.

## Décisions d'ArgentVault examinées

| Décision | Avis et preuve | Couverture réelle |
|---|---|---|
| (a) Pause avant échéance dans approve | Cohérent avec l'interdiction de sortie en pause. Même tardif, approve échoue en pause ; expire permet la libération sans paiement. ArgentVault.sol:211 et :214 ; specs/02-contrat.md:164. | Pause avant échéance exercée dans test_Cas1_approbationEnPause_echoue_refusPossible ; expiration en pause agent exercée. Approve combinant pause et échéance déjà dépassée n'a pas de test dédié. |
| (b) Échéance incluse | Cohérent : approve paie à t = deadline, expire exige t > deadline, sans chevauchement. ArgentVault.sol:214 et :241. La spec dit avant/après sans préciser l'égalité. | test_Scenario6a_ApprobationAvantEcheance se place exactement à l'échéance ; test_Cas1_expireAvantEcheance_echoue rejette expire exactement à cette borne. Cette précision gagnerait à entrer dans la spec. |
| (c) HoldReleased aussi à l'approbation | Cohérent : l'événement traduit la sortie du hold, y compris avec paiement. Decision(APPROVED), HoldReleased puis Paid sont émis avant le transfert, ArgentVault.sol:226. Conforme à specs/02-contrat.md:228. | L'état libéré et Paid sont testés ; aucune assertion ciblée n'exige HoldReleased sur approve. Un indexeur doit distinguer libération et refus par Decision/Paid. |
| (d) pauseAgent inconnu échoue | Cohérent avec un registre explicite ; ne crée pas une pause anticipée pour un agent futur. ArgentVault.sol:342. | test_Pause_agent attend UnknownAgent. L'interface ne détaillait pas cette précondition. |
| (e) Seuil/réserve 0, délai 1 h | Le seuil nul impose une validation humaine pour toute référence de montant positif, ArgentVault.sol:126 et :186. La réserve nulle ne protège aucun coussin avant configuration. Délai initial 1 h, setter borné 10 s à 7 jours. Le script déploie sans initialiser ces paramètres. | Valeurs lues dans le constructeur/storage ; aucun test ciblé des trois valeurs initiales. Les tests configurent ensuite seuil, réserve et délai. Choix acceptable pour la démo si configuration effective vérifiée avant usage. |
| (f) Cinq incorrect-equality | Les cinq sont des faux positifs, détaillés séparément ci-dessous. | Conclusion de lecture du flux et des types ; aucune suppression automatique des autres alertes n'en découle. |

## Alertes Slither

Les identifiants M désignent l'ordre du JSON de l'analyse marché ; la colonne V donne l'entrée équivalente du JSON de la copie de feat/argent-vault. Chaque résultat est classé, y compris les alertes informatives et d'optimisation. Les alertes communes ne sont pas comptées deux fois dans les constats. Une alerte acceptée reste visible dans les sorties brutes.

### Marché, 36 résultats communs aux deux analyses

| M | V | Détecteur, preuve | Classement et justification |
|---:|---:|---|---|
| 1 | 1 | arbitrary-send-eth, VerifierRegistry.sol:209 | Faux positif pour destination arbitraire : trésor fixé au constructeur, pas un paramètre de l'appelant. Le risque de destinataire défaillant reste M5. |
| 2 | 2 | weak-prng, DrawnVerificationMarket.sol:189 | Vraie alerte, biais d'aléa et pool adaptatif, M1. Risque accepté pour la démo ; gravité interne moyenne malgré le classement High de l'outil. |
| 3 | 3 | divide-before-multiply, Rewards.sol:88 et :91 | Faux positif : partage entier volontaire, reste explicitement crédité au trésor, test_distribute_remainderToTreasury. |
| 4 | 7 | incorrect-equality, VerificationMarket.sol:224 | Faux positif : Status.None identifie une demande inexistante, pas une égalité de solde ou d'heure. |
| 5 | 9 | incorrect-equality, VerificationMarket.sol:232 | Faux positif : même sentinelle d'inexistence dans getCommittee. |
| 6 | 11 | incorrect-equality, VerificationMarket.sol:251 | Faux positif : même sentinelle dans isCommitteeMember. |
| 7 | 12 | uninitialized-local, Slashing.sol:129 | Faux positif : fault est affecté dans chaque branche qui atteint la saisie ; la troisième branche revert. |
| 8 | 13 | uninitialized-local, DrawnVerificationMarket.sol:186 | Faux positif : les trois cases du tableau committee sont remplies par la boucle k < 3 avant usage. |
| 9 | 14 | uninitialized-local, Slashing.sol:130 | Faux positif : bps est affecté dans les deux branches poursuivies, sinon revert. |
| 10 | 15 | unused-return, DrawnVerificationMarket.sol:325 | Acceptée : l'index de feedback retourné n'est pas nécessaire au marché ; son dépôt consultatif ne commande aucun paiement. |
| 11 | 22 | calls-loop, DrawnVerificationMarket.sol:176 | Vraie alerte de coût croissant, lecture locked par candidat. Aucun plafond de pool ni mesure de capacité ; B7. |
| 12 | 23 | calls-loop, DrawnVerificationMarket.sol:170 | Vraie alerte de coût croissant, isActive par candidat ; B7. |
| 13 | 24 | calls-loop, DrawnVerificationMarket.sol:311 | Acceptée : trois membres au plus, lecture d'identité dans le crochet ERC-8004 isolé. |
| 14 | 25 | calls-loop, DrawnVerificationMarket.sol:174 | Vraie alerte de coût croissant, total par candidat ; B7. |
| 15 | 26 | calls-loop, DrawnVerificationMarket.sol:325 | Acceptée : trois retours au plus, appels protégés par try/catch. L'exhaustivité des notifications n'est pas garantie. |
| 16 | 27 | calls-loop, Rewards.sol:106 | Acceptée : trois reveals au plus dans les marchés câblés ; précompilé de confiance. La révocation de frappe reste M5. |
| 17 | 28 | calls-loop, DrawnVerificationMarket.sol:172 | Vraie alerte de coût croissant, struckUntil par candidat ; B7. |
| 18 | 29 | reentrancy-benign, Slashing.sol:142 et :147 | Acceptée sous trésor EOA de confiance : slashed écrit avant l'appel, mais strike écrit après transfert indirect. Ce n'est pas une absence générale de callback ; M5. |
| 19 | 30 | reentrancy-events, Slashing.sol:145 et :221 | Acceptée sous la même hypothèse : événements postérieurs au transfert indirect. Callback contractuel hostile non testé. |
| 20 | 31 | reentrancy-events, Slashing.sol:194 et :196 | Acceptée sous trésor EOA de confiance ; saisie unique engagée avant transfert, événements après. |
| 21 | 32 | reentrancy-events, DrawnVerificationMarket.sol:210 | Faux positif pour le registre fourni : lockStake modifie la comptabilité sans call vers un destinataire ; drawn et comité écrits avant les trois verrous. |
| 22 | 35 | timestamp, VerificationMarket.sol:281 | Acceptée : transition temporelle voulue. Disponibilité et dérive ne sont pas garanties, M2. |
| 23 | 36 | timestamp, VerificationMarket.sol:232 | Faux positif : comparaison d'enum None, sans comparaison temporelle dans la condition signalée. |
| 24 | 38 | timestamp, VerificationMarket.sol:154 | Acceptée : finalisation après fenêtre, ou anticipée avec trois reveals. |
| 25 | 39 | timestamp, VerificationMarket.sol:119 | Acceptée : limite de reveal explicite et testée. |
| 26 | 41 | timestamp, VerificationMarket.sol:224 | Faux positif : comparaison d'enum None, propagation de dépendance trop large. |
| 27 | 45 | timestamp, Slashing.sol:166 | Acceptée : fermeture temporelle de contestation, frontière testée. |
| 28 | 46 | timestamp, VerificationMarket.sol:203 | Acceptée : close exige la fin de contestation ; appel actif requis. |
| 29 | 48 | timestamp, VerificationMarket.sol:251 | Faux positif : comparaison d'enum None, sans horloge dans la condition. |
| 30 | 49 | cyclomatic-complexity, DrawnVerificationMarket.sol:133 | Acceptée : complexité réelle du filtrage/tirage ; tests ciblés, sans garantie de toutes les séquences adverses. |
| 31 | 50 | cyclomatic-complexity, VerificationMarket.sol:137 | Acceptée : agrégation complexe ; test_finalize_aggregationExhaustive, propriété bornée à cette règle. |
| 32 | 51 | low-level-calls, VerifierRegistry.sol:209 | Acceptée : transfert natif vérifiant ok, effets avant call ; réserve de disponibilité M5. |
| 33 | 52 | low-level-calls, Rewards.sol:121 | Acceptée : claimable mis à zéro avant call et échec propagé. Pas de test ciblé de bénéficiaire réentrant. |
| 34 | 54 | low-level-calls, VerifierRegistry.sol:137 | Acceptée : sortie et total remis à zéro avant remboursement, ok exigé. |
| 35 | 56 | unindexed-event-address, DrawnVerificationMarket.sol:68 | Acceptée : coût de filtrage des événements, pas une autorisation manquante. |
| 36 | 57 | immutable-states, VerifierRegistry.sol:33 | Acceptée : treasury n'a aucun setter ; optimisation possible, pas un changement de destinataire accessible. |

### ArgentVault, 21 résultats supplémentaires

| V | Détecteur, preuve | Classement et justification |
|---:|---|---|
| 4 | incorrect-equality, ArgentVault.sol:219 | Faux positif : p.action == PAY_INVOICE choisit le registre. Pending provient uniquement d'une action 1 ou 2 validée avant _hold. |
| 5 | incorrect-equality, ArgentVault.sol:223 | Faux positif : p.action == PLACE retire heldPlacements uniquement pour un placement validé. |
| 6 | incorrect-equality, ArgentVault.sol:513 | Faux positif : _release restaure le registre correspondant à l'action validée. |
| 8 | incorrect-equality, ArgentVault.sol:526 | Faux positif : seules les factures réglées sont retirées d'admittedDebts. Action validée avant le règlement. |
| 10 | incorrect-equality, ArgentVault.sol:531 | Faux positif : deadline == 0 est une sentinelle de Pending absent. Un hold reçoit timestamp + délai positif ; délai minimal 10 s, initial 1 h. Une addition uint64 hors borne revert au lieu de créer une échéance nulle. |
| 16 | missing-zero-check, ArgentVault.sol:145 | Faux positif : owner_ est contrôlé dans accounts par la boucle :138 à :143. |
| 17 | missing-zero-check, ArgentVault.sol:148 | Faux positif : approver_ contrôlé par la même boucle. |
| 18 | missing-zero-check, ArgentVault.sol:149 | Faux positif : guardian_ contrôlé par la même boucle. |
| 19 | missing-zero-check, ArgentVault.sol:151 | Faux positif : clientSigner_ contrôlé par la même boucle. |
| 20 | missing-zero-check, ArgentVault.sol:146 | Faux positif : admission_ contrôlé par la même boucle. |
| 21 | missing-zero-check, ArgentVault.sol:147 | Faux positif : relay_ contrôlé par la même boucle. |
| 33 | timestamp, ArgentVault.sol:491 et :492 | Faux positif pour le détecteur temporel : compare montant à cash libre ou plaçable, sans horloge dans ces expressions. La réserve à approve reste un défaut distinct, M4. |
| 34 | timestamp, ArgentVault.sol:513 | Faux positif : comparaison d'action discrète, pas d'échéance. |
| 37 | timestamp, ArgentVault.sol:526 | Faux positif : comparaison d'action discrète. |
| 40 | timestamp, ArgentVault.sol:214 | Acceptée : expiration humaine voulue ; borne incluse testée. Les égalités d'action :219 et :223 aussi signalées par ce résultat sont des faux positifs. |
| 42 | timestamp, ArgentVault.sol:531 | Faux positif : existence d'un Pending via sentinelle zéro ; ne compare pas l'heure présente à l'échéance. |
| 43 | timestamp, ArgentVault.sol:387 | Faux positif : comparaison comptable balance > locked, sans horloge. |
| 44 | timestamp, ArgentVault.sol:241 | Acceptée : expire exige strictement le dépassement de deadline ; appel actif requis sur le L1. |
| 47 | timestamp, ArgentVault.sol:469 et :472 | Acceptée : TTL, émission future et expiration signés, bornes exercées ; dépendance au timestamp du validateur assumée. |
| 53 | low-level-calls, ArgentVault.sol:229 | Acceptée : transfert natif après effets et sous verrou manuel, retour ok exigé ; tests de réentrance et d'échec approve. |
| 55 | low-level-calls, ArgentVault.sol:197 | Acceptée : mêmes contrôles à submit, tests de signature, réentrance et annulation du transfert. |

Les cinq incorrect-equality propres au coffre sont donc bien des faux positifs, chacun pour une raison de type ou de sentinelle. Les alertes significatives restantes concernent surtout l'aléa, le coût du pool, l'horloge et les hypothèses des appels externes. Slither n'a pas signalé M4 : l'absence d'alerte ne vaut pas preuve de l'invariant de réserve.

Décompte des classements : marché, 12 faux positifs, 5 vraies alertes et 19 alertes acceptées ; branche du coffre, 28 faux positifs, les mêmes 5 vraies alertes et 24 alertes acceptées. Les cinq vraies alertes sont le PRNG et quatre appels en boucle sur le pool ; leurs risques sont explicitement acceptés pour le cadre restreint de la démo, M1 et B7. Aucun résultat n'est laissé sans qualification.

## Limites assumées

1. **Un seul validateur.** Aucune décentralisation effective ni continuité d'état après panne n'est démontrée. Le repli est un autre réseau, pas une réplication. Sources : infra/l1/README.md:4 et :48 ; le ValidatorManager PoA n'est pas initialisé, le L1 tourne avec son seul validateur de conversion.
2. **Clés de test du mnemonic public admises sur le L1 AWS.** La frontière pratique de la démo repose sur l'accès réseau au RPC ; les comptes ne prouvent pas des identités indépendantes. Sources : script/deploy-all.sh:96 ; docs-jury/preuves/scene-aws.md.
3. **Évaluateur factice à ce jour.** Le processus hors chaîne existe, mais son évaluation par défaut applique des règles fixes. Aucune qualité, latence ou robustesse d'un LLM réel n'est mesurée dans cette revue. Source : offchain/DESIGN.md:61 et :99.
4. **Centralisation de l'administration.** Admission réseau, frappe et politiques restent des pouvoirs de confiance. VetoDesk n'atteste pas un paiement externe ; aucun plafond global Native Minter ni contrôle multisignature n'est démontré. Sources : infra/l1/fuji/genesis-fuji.json:30 et :36 ; src/Slashing.sol:100 ; src/VetoDesk.sol:59.
5. **Transfert natif d'ArgentVault = virement simulé.** Le contrat audité transfère réellement le jeton natif de test. Dans la production envisagée, Paid serait une autorisation consommée par un connecteur bancaire, qui n'est pas construit ni éprouvé ici. Source : src/ArgentVault.sol:11 à :14.
6. **ArgentVault décide sans vote du marché au temps 1.** Aucun couplage de code final du marché à approve ou submit n'existe dans le coffre audité. Un paiement n'attend donc pas la contestation du marché. Source : src/ArgentVault.sol:6 à :10 et :176.
7. **Rejeu entre réseaux clonés.** Le domaine EIP-712 sépare chaînes de chainId différent et contrats d'adresse différente. Deux réseaux ayant même chainId et même adresse de coffre ne sont pas distingués par ce domaine ; ce cas n'est pas testé. Source : src/ArgentVault.sol:441 ; infra/l1/README.md:3.
8. **Confidentialité limitée.** ValidatorOnly limite la synchronisation ; il ne chiffre pas les données pour le validateur. Les verdicts et faits de contestation sont publics aux lecteurs admis du réseau. L'effacement du cache ne garantit pas l'effacement des copies. Sources : src/Slashing.sol:157 ; src/VerificationMarket.sol:133 ; offchain/DESIGN.md:77.
9. **Sanctions et réputation partielles.** Les taux sont choisis pour la démo. La réputation récompense la participation ; elle ne prouve ni vérité, ni solvabilité, ni mandat de paiement. Les notifications peuvent échouer silencieusement. Sources : src/Slashing.sol:32 ; src/DrawnVerificationMarket.sol:278 et :313.
10. **Portée des tests.** Les suites locales et la scène historique ne couvrent pas une intrusion complète, une compromission admin, une panne suivie d'une reprise complète, ni l'intégration bancaire. Le scénario M4 reste une preuve de lecture, sans nouveau test ajouté pendant cette revue.
