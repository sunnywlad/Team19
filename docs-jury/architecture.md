# Architecture

## Le L1 privé VETO

Nous faisons tourner le L1 Avalanche privé de démonstration sur AWS, de jeton
natif VETO. Son RPC est privé, accessible par tunnel. La démo vise ce L1,
enregistré sur la P-Chain Fuji, plutôt que la C-Chain Fuji.

| Trait | Valeur |
|---|---|
| chainId | 191919 |
| Consensus | PoA (preuve d'autorité) |
| Écriture | TxAllowList : seule une adresse admise envoie une transaction. |
| Frappe de VETO | Native Minter : un précompilé frappe le jeton natif. |
| Messagerie inter-chaînes | Pas d'ICM applicatif : ni TeleporterMessenger ni relayer. Le warpConfig reste actif dans la genèse, requis par le ValidatorManager pour parler à la P-Chain. |
| Validateurs | un seul validateur pour la démo. |

Les deux précompilés sont activés dans la genèse. La TxAllowList siège à
`0x02...02`, le Native Minter à `0x02...01`. Leur administrateur est l'adresse
admin du L1. Le gasLimit du bloc vaut 8 000 000.

Sources : `infra/l1/README.md`, section « Ce qui rend le L1 privé » ;
`infra/l1/fuji/genesis-fuji.json` (`chainId`, `gasLimit`, précompilés) ;
`Team19-notes/etat-run.md`, section « Run AWS de bout en bout ».

## Intégration au projet

```text
Flux de l'équipe, interface du temps 1 :
agent → relais → ArgentVault → événements Decision / Paid → dashboard
                      │
                      └→ décision déterministe sur ses registres et ses fonds

Marché de vérification, parcours relié et joué sur le L1 AWS :
passerelle → createRequest(H) → tirage du comité → commit → reveal → verdict
     ↕                                                               │
cache ← vérificateurs ← évaluateur factice                            └→ passerelle

Temps 2 : verdict du marché ··· jonction à construire ··· ArgentVault
```

La passerelle, le cache, les services vérificateurs et le marché sont reliés.
Le parcours de bout en bout atteint la clôture sur le L1 local et le L1 AWS.
Les évaluateurs branchés sont des stubs déterministes ; les véritables
vérificateurs LLM restent à brancher.

Le flux agent, relais, coffre et dashboard décrit l'interface de l'équipe.
Le script de déploiement du coffre a été joué sur anvil ; il ne démontre pas à
lui seul l'intégration complète au dashboard. Au temps 1, ArgentVault décide sans
le vote du marché. La jonction entre le verdict et le coffre appartient au
temps 2 et n'est pas encore construite.

Sources : `specs/02-contrat.md`, sections « Principes », « submit » et
« Événements » ; branche `feat/argent-vault`, `src/ArgentVault.sol:5` et
`script/DeployArgentVault.s.sol` ; `offchain/DESIGN.md` ; `Team19-notes/etat-offchain.md`,
section « Constats pour la session contrats » ; `Team19-notes/etat-run.md`,
section « Run AWS de bout en bout ».

## Les contrats par phase

Nous avons construit la pile en trois phases. Chaque phase ajoute une couche sans
réécrire la précédente.

### Phase 1 : le marché à comité fixe

| Contrat | Rôle |
|---|---|
| `VerificationMarket` | Reçoit une demande payée en VETO, retient un commit puis un reveal par membre, agrège en code 0/1/2, ouvre la contestation. Le comité de 3 est figé au déploiement. |

### Phase 2 : caution, sanctions, récompenses, guichet

| Contrat | Rôle |
|---|---|
| `VerifierRegistry` | Inscrit les vérificateurs admis, garde leur caution en VETO, bloque une part par mission. |
| `StakedVerificationMarket` | Le marché de phase 1 cautionné. Verrouille la caution à la création, saisit les absents et partage les frais à la finalisation, déverrouille à la clôture. |
| `Slashing` | Constate les fautes, saisit la caution, tient les strikes et l'exclusion. |
| `Rewards` | Partage les frais entre les reveals valides, en modèle pull ; frappe un bonus en VETO par reveal valide. |
| `VetoDesk` | Guichet : un opérateur frappe des VETO pour un client payé hors chaîne. |

VetoDesk refuse une référence de paiement déjà créditée. Il ne vérifie pas
un règlement bancaire : l'opérateur atteste le paiement hors chaîne.
Source : `src/VetoDesk.sol:7`, `src/VetoDesk.sol:59`.

### Phase 3 : tirage au sort et registres ERC-8004

| Contrat | Rôle |
|---|---|
| `DrawnVerificationMarket` | Le marché cautionné dont le comité de 3 est tiré au sort par demande, à partir du hash d'un bloc postérieur à la création. |
| `AgentIdentityRegistry` | Identité d'agent, jeton ERC-721 non transférable. |
| `AgentReputationRegistry` | Retours de réputation sur un agent. |
| `AgentValidationRegistry` | Demandes et réponses de validation d'un agent. |

Les trois registres ERC-8004 sont un sous-ensemble adapté du standard, sans
dépendance externe. Les noms de fonctions et d'événements du standard sont
conservés. Le marché de phase 3 écrit un retour de réputation à la finalisation,
sans jamais pouvoir faire échouer la finalisation.

Sources des contrats et du comité de trois membres : `src/VerificationMarket.sol`,
`src/StakedVerificationMarket.sol`, `src/DrawnVerificationMarket.sol`,
`src/VerifierRegistry.sol`, `src/Slashing.sol`, `src/Rewards.sol` et `src/erc8004/`.

### ArgentVault : le coffre de décision et de paiement

Nous vérifions la signature du client et les droits de l'agent sur des actions préenregistrées.
Nous protégeons les dettes admises, la réserve de sécurité et les montants en attente d'approbation.
Nous refusons, bloquons pour validation humaine ou payons le bénéficiaire inscrit dans la transaction.

Statut : **écrit et testé (77 tests), joué sur anvil, pas encore déployé sur le L1**.
Les décisions sont 0 (refus), 1 (validation humaine) et 2 (acceptation).
Sur le réseau de test, le transfert natif tient lieu de virement simulé.
En production, `Paid` est l'autorisation qu'un connecteur bancaire consomme ;
ce connecteur reste à construire. Le contrat actuel effectue un transfert natif.

Sources : `specs/02-contrat.md`, sections « Principes », « Montant plaçable »,
« Cas 1 » et « Événements » ; branche `feat/argent-vault`,
`src/ArgentVault.sol:5`, `test/ArgentVault.t.sol` et `script/DeployArgentVault.s.sol`.
Le décompte des 77 tests est mesuré par `forge test --summary` dans cette
branche, détaillé dans [tests.md](tests.md).

## La part hors chaîne

Le contenu d'une demande ne passe jamais par la chaîne. Seul le hash H y est
inscrit.

- Le cache stocke le contenu adressé par H, contrôle le droit de lecture sur la
  chaîne, et supprime à la clôture.
- La passerelle est la seule porte vers le L1 depuis l'extérieur ; elle dépose
  au cache, envoie les transactions, et relit les événements.
- Les services vérificateurs écoutent les événements, lancent un processus
  d'évaluation neuf par demande, et jouent le commit puis le reveal. L'évaluateur
  actuel est factice ; le branchement LLM reste à faire.

Sources : `offchain/DESIGN.md`, `offchain/cache/server.ts`,
`offchain/gateway/server.ts`, `offchain/verifier/evaluator.ts` et
`offchain/evaluator-stub/index.ts`.
