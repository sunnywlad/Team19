# Prototype local : comité de cinq

Branche `experiment/comite-cinq`, base `5a4ebc9`. Expérience isolée du
11 octobre 2026. Aucun remplacement de contrat officiel, déploiement AWS ou
appel LLM dans cette expérience Solidity. Les résultats ne mesurent pas
l'efficacité de détection : ils vérifient le fonctionnement du comité.

## Contrats

- [VerificationMarketFive.sol](VerificationMarketFive.sol) : base commune
  et marché fixe, cinq adresses distinctes non nulles.
- [DrawnVerificationMarketFive.sol](DrawnVerificationMarketFive.sol) : marché
  tiré, cinq membres distincts, cinq cautions, sanctions, récompenses et
  notifications ERC-8004. `VerifierRegistry`, `Slashing`, `Rewards` et les
  registres ERC-8004 officiels sont réutilisés sans modification.
- [Tests fixes](../../test/experimental/VerificationMarketFive.t.sol) et
  [tests tirés](../../test/experimental/DrawnVerificationMarketFive.t.sol).

Les marchés officiels de trois vérificateurs et leurs scripts restent présents.
Le marché fixe à trois utilise `address[3]`, le prototype fixe `address[5]`.
`getCommittee` et `CommitteeDrawn` restent des tableaux dynamiques ; leurs
sélecteurs et la forme des événements sont compatibles. Le prototype tiré
conserve la signature du constructeur du marché tiré officiel.

Une pile tirée neuve nécessite **de nouveaux Registry, Slashing et Rewards** :
leur `setMarket` est à usage unique. On ne peut pas recâbler la pile AWS
existante vers ce prototype. Au moins cinq vérificateurs actifs, admissibles,
différents du demandeur et avec assez de caution libre sont nécessaires.

## Règle : quorum trois, acceptation unanime des révélés

La règle officielle trois n'est pas une simple majorité d'acceptation. Elle
utilise un quorum de deux, une majorité stricte pour refuser et l'unanimité des
révélés pour accepter. Ce prototype conserve cette règle, avec quorum de trois.
Il n'existe ni poids de confiance ni veto automatique par un motif dans cette
base. Les motifs liés à un prédicat sont sanctionnés via `Slashing`.

| Révélations du comité cinq | Résultat |
|---|---|
| 5 Accept | Accept, finalisation anticipée possible |
| 3 Accept + 2 absents | Accept seulement après la fin de reveal |
| 3 Accept + 2 Refuse | HumanReview |
| 3 Refuse + 2 Accept | Refuse |
| 4 Accept + 1 HumanReview | HumanReview |
| 2 Accept + 3 absents | HumanReview |
| Aucun comité tiré | HumanReview après échéance, frais au trésor |

Tout membre qui révèle une revue humaine empêche l'acceptation. Une majorité
stricte de refus parmi les révélés produit Refuse si le quorum est atteint.
La finalisation anticipée nécessite les cinq révélations, même si trois votes
de refus semblent déjà suffisants. Le désaccord minoritaire n'est pas une faute.

La contestation d'un vote faux saisit la caution mais **ne réécrit pas le code
final**, comme dans le marché officiel. Les tests le vérifient. Le comité ne
commande actuellement aucun paiement du coffre.

## Vérification locale

Avec Foundry et `forge-std` installés :

```sh
forge test --offline --match-path 'test/experimental/*.t.sol' -vv
forge fmt --check src/experimental test/experimental
forge test --offline -vv
```

La suite expérimentale comprend 18 tests : 1 024 combinaisons des états
Absent/Refuse/HumanReview/Accept, dont les 243 combinaisons de cinq votes
complets ; 256 graines de tirage fuzz ; bords quorum et échéance ; appartenance,
adresses nulles et doublons ; cautions de cinq membres ; absence de commit
saisie à 1 %, commit sans reveal à 5 % ; prédicats erronés à 20 % ; égalité des
frais entre révélés, reste au trésor, bonus par révélation et retraits ;
déverrouillage des cinq cautions à la clôture ; notifications ERC-8004 des cinq.
Les 1 024 cas sont répartis en quatre tests pour respecter la limite mémoire
et gaz du lanceur. Aucun changement du profil Foundry ou compilation viaIR.

## Changements encore nécessaires pour une pile HTTP/LLM cinq

Ces adaptations sont **identifiées, pas implémentées** dans cette expérience.

| Point actuel | Adaptation nécessaire |
|---|---|
| `offchain/verifier/service.ts:501`, `revealCount >= 3` | Comparer au nombre réel de membres de `getCommittee`, avec comité non vide. Sinon la finalisation est tentée trop tôt à trois révélations et revert jusqu'à la cinquième ou l'échéance. |
| `offchain/e2e.sh`, clés index 1,2,3, demandeur index 4 | Prévoir cinq clés distinctes et un demandeur distinct, par exemple index 6 ; ne pas utiliser le demandeur comme quatrième vérificateur. |
| `offchain/e2e.sh`, trois dossiers, services, contrôles actifs, journaux et caution | Boucles paramétrées de 1 à 5, cinq dossiers persistants séparés, cinq commandes d'évaluation. |
| `offchain/e2e.sh:539`, minimum trois événements | Exiger cinq révélations dans le scénario nominal ; conserver des assertions séparées pour les scénarios d'absence. |
| `script/DeployPhase3.s.sol`, quatre candidats admis | Nouveau script expérimental : marché cinq, pile neuve et au moins cinq candidats éligibles, idéalement davantage pour un vrai choix de tirage. |
| `offchain/tools/demander.mjs:90`, alerte sous trois votes | Se baser sur la taille réelle du comité. |
| Mocks et tests hors chaîne fixés à trois | Ajouter fixtures cinq et tests de cycle complet, absences, reprise et nombre exact d'événements. |

Le cache et la passerelle lisent déjà des tableaux dynamiques et parcourent les
membres. Le service de vérification traite déjà l'appartenance à partir de
`CommitteeDrawn`. Leur compatibilité complète avec cinq processus reste à
tester après les adaptations de lancement et finalisation.

À modèles et prompts identiques, cinq évaluations par demande représentent
**5/3 des appels LLM et des bonus par révélation** du comité trois, soit +66,7 %
si les cinq répondent. À frais constants, la part par vérificateur descend de
`fee/3` à `fee/5`, hors reste. Commit/reveal passe de six à dix transactions.
La caution globale verrouillée passe de trois parts à cinq parts. Ces rapports
sont des comptages, pas une mesure de coût monétaire ou de latence. Les appels
peuvent être parallèles ; la cinquième réponse lente peut retarder la décision.
Cinq copies d'un même modèle ne démontrent pas cinq erreurs indépendantes.

Pour comparer la détection, soumettre exactement les mêmes documents hostiles
et légitimes aux comités trois et cinq, conserver les votes bruts et appliquer
ces règles. Rapporter refus, revue humaine, acceptation et timeout séparément,
ainsi que faux positifs et délai. Ne pas substituer ces résultats aux métriques
du filtre déterministe ni conclure à une amélioration avant la mesure.
