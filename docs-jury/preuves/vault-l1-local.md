Ce que c'est : répétition d'ArgentVault sur un L1 local identique au L1 de démo (chainId 191919, TxAllowList) : 20 transactions, décisions 0/1/2, refus, expiration, rejeu, pause.
Commande : `forge script script/DeployArgentVault.s.sol --rpc-url <RPC du L1> --broadcast --slow, puis script/RehearseArgentVault.s.sol run() et finish(), relus par cast`

```text
=== Répétition ArgentVault, L1 local :9654 — 2026-10-11T02:16:21Z
--- Étape 1 : chainId 191919, bloc 875
--- Étape 2 : admission (setEnabled) et VETO (mintNativeCoin), signés par l'admin local 0x8db9…52FC
setEnabled tx 0xf20f006a7ee1732dd9a9c2e1f1e2ef2ee2ef6e08ef5d6892f5c6731d8e782be1 statut 0x1
mint tx 0xdb3412b3bbceacec308a9427f61083cd27cdaa07f90a742babf5d31caa68c004 statut 0x1
index 10 proprietaire 0xBcd4042DE499D14e55001CcbB24a551F3b954096 readAllowList=1 solde=300.000000000000000000 VETO
setEnabled tx 0x5bed846eaaf66e4fdca9a4ccdb3c1586dd75311cdd6f6a0ff5c439a3bd00f215 statut 0x1
mint tx 0x64381f18b8f639e7c87e0cbbd544c67903f22e56132724f964170f8ab79a4e0a statut 0x1
index 11 admission 0x71bE63f3384f5fb98995898A86B02Fb2426c5788 readAllowList=1 solde=100.000000000000000000 VETO
setEnabled tx 0x1b8a70de4cc120bb5f55d10b47fb282a9062711cc58b815ed6b0269e8f0501cc statut 0x1
mint tx 0xe6590c6b10c59f57719d1b1ecc4188d810ecb1845a684007ce1dc61e8bf72654 statut 0x1
index 12 relais 0xFABB0ac9d68B0B445fB7357272Ff202C5651694a readAllowList=1 solde=100.000000000000000000 VETO
setEnabled tx 0x02c2b07e97d4094167fe74ed0a5429ba410d19e281771664400dbac737323b32 statut 0x1
mint tx 0x6b313762a9f6d4405075f1a07e03d3d70227b372d6459af6f35594eeb650ff96 statut 0x1
index 13 approbateur 0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec readAllowList=1 solde=100.000000000000000000 VETO
setEnabled tx 0x9be12dba136f535fa33f8f70bd12487e5cacc820112837ba3644bf802934c708 statut 0x1
mint tx 0xabb11a8480459da4a0f3040e31836cde109292aab0a56e59503eae7c2a8090f4 statut 0x1
index 14 gardien 0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097 readAllowList=1 solde=100.000000000000000000 VETO
setEnabled tx 0x4b65bfbc7d00cc1b06050a59841830a26938d534d01aec8d22108f3d503694e3 statut 0x1
mint tx 0xd0a01697a8a1939ab7a64d2c1d9cbea4609a4dd4d9f7c7e753c1dd9211668bf6 statut 0x1
index 15 signataire 0xcd3B766CCDd6AE721141F452C550Ca635964ce71 readAllowList=1 solde=100.000000000000000000 VETO
mint tx (index 16, non admis) 0x5e4977cfb94a36b07ad543ebc66fcc03757ee8b3b4a992aacbd41471eef94e03 statut 0x1
index 16 non-admis 0x2546BcD3c84621e976D8185a91A922aE77ECEc30 readAllowList=0 solde=1.000000000000000000 VETO
--- Étape 3 : forge script script/DeployArgentVault.s.sol --broadcast --slow
Script ran successfully.
== Return ==
vault: contract ArgentVault 0xfbfbfDdd6e35dA57b7B0F9a2C10E34Be70B3A4E9
== Logs ==
  ArgentVault 0xfbfbfDdd6e35dA57b7B0F9a2C10E34Be70B3A4E9
  chainId 191919
ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.
--- Étape 3 : relecture par cast call, coffre 0xfbfbfDdd6e35dA57b7B0F9a2C10E34Be70B3A4E9
code: 10555 octets
owner() = 0xBcd4042DE499D14e55001CcbB24a551F3b954096
admission() = 0x71bE63f3384f5fb98995898A86B02Fb2426c5788
relay() = 0xFABB0ac9d68B0B445fB7357272Ff202C5651694a
approver() = 0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec
guardian() = 0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097
clientSigner() = 0xcd3B766CCDd6AE721141F452C550Ca635964ce71
clientId() = 0xce665c932b8b6adb314bf6ba6b5561b528027ce19de675f4c3136d7f91bf23a8 (C-DEMO attendu 0xce665c93…23a8)
threshold() = 0
safetyReserve() = 0
cash() = 0
admittedDebts() = 0
totalHeld() = 0
placeable() = 0
approvalDelay() = 3600
vaultPaused() = false
--- Étape 2 (suite) : adresse NON admise (index 16) appelle fund() sur le coffre
sortie cast send: 1
Error: server returned an error response: error code -32000: cannot issue transaction from non-allow listed address: 0x2546BcD3c84621e976D8185a91A922aE77ECEc30
solde index 16 après: 1.000000000000000000, cash coffre: 0
--- Étape 4a : transaction neutre (propriétaire vers lui-même, 0 VETO) pour caler block.timestamp
dernier bloc avant: 910, ts 1791685221, horloge 1791685222
neutre tx 0x83e2111beb99ea61ec156d14459f7e6ebb42dabc8eecd3c60c95f965b74dc050 bloc 0x38f statut 0x1
dernier bloc après: ts 1791685223
--- Étape 4a : forge script RehearseArgentVault run() --broadcast --slow
Script ran successfully.
== Logs ==
  R1 2 0
  R2 1 10
  R3 1 10
  coffre 0xfbfbfDdd6e35dA57b7B0F9a2C10E34Be70B3A4E9
  beneficiaire B-001 0xD4993522a705ebC29cD3Cc5c5e4F96F475A49Ae8
  solde B-001 (wei) 10000000000000000
  cash (wei) 90000000000000000
  echeance R3 1791685253
  issuedAt R1 1791685223
ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.
--- Étape 4b : échéance réelle de R3 (0xa82911dadedd085c3d61202433f6671483f743aa1be55de4de4e203a42514aff)
pendingApproval(R3).deadline = 0 ; bloc courant ts 1791685261
horloge 1791685266 > échéance ; ts du dernier bloc encore 1791685266
neutre tx 0x904c49d8de517dae8f39bbafee1fd4423c5837b5e7cb421d6b9f0e38d7c56a78 bloc 0x3a0 statut 0x1
ts du dernier bloc après la transaction neutre: 1791685268
--- Étape 4b : forge script RehearseArgentVault finish() --broadcast --slow (REPLAY_ISSUED_AT=1791685223)
  [187667] RehearseArgentVault::finish()
    └─ ← [Revert] echeance de R3 non atteinte : transaction neutre d'abord
Error: script failed: echeance de R3 non atteinte : transaction neutre d'abord
(note) premier essai de finish() arrêté en simulation par sa garde, rien de diffusé : l attente shell lisait R3 avec vault=address(0) (deadline 0), donc aucune attente ; identifiant recalculé par cast keccak(abi.encode(...))
--- Étape 4b (reprise) : R3 = 0x047be7fc61d4202670a2a132e805c923b1c1428dd7eeb46cdfaa12fed719ede5
pendingApproval(R3).deadline = 1791685277 [1.791e9] ; ts du dernier bloc 1791685316
horloge 1791685334 > échéance 1791685277
neutre tx 0xec989f3a8c425fa075e7ce26315b04947010a2dab90367ea843e85e2557a5497 bloc 0x3b1 statut 0x1
ts du dernier bloc après la transaction neutre: 1791685336
--- Étape 4b : forge script RehearseArgentVault finish() --broadcast --slow (REPLAY_ISSUED_AT=1791685223)
Script ran successfully.
== Logs ==
  R4 1 10
  rejeu R1 0 3
  R5 0 4
  solde B-001 (wei) 40000000000000000
  cash (wei) 60000000000000000
  admittedDebts (wei) 0
  totalHeld (wei) 0
  placeable (wei) 20000000000000000
ONCHAIN EXECUTION COMPLETE & SUCCESSFUL.
--- Étape 5 : relecture par cast (reçus, événements, soldes), depuis le bloc 889
reçus des transactions diffusées (statut, bloc, gaz) :
DeployArgentVault.s.sol/run-latest.json #0 create statut 0x1 bloc 889 gaz 2390880 
RehearseArgentVault.s.sol/run-latest.json #0 setThreshold(uint256) statut 0x1 bloc 912 gaz 45014 
RehearseArgentVault.s.sol/run-latest.json #1 setSafetyReserve(uint256) statut 0x1 bloc 913 gaz 45024 
RehearseArgentVault.s.sol/run-latest.json #2 setApprovalDelay(uint64) statut 0x1 bloc 914 gaz 28167 
RehearseArgentVault.s.sol/run-latest.json #3 registerAgent(bytes32,uint8) statut 0x1 bloc 915 gaz 46260 
RehearseArgentVault.s.sol/run-latest.json #4 registerBeneficiary(bytes32,address) statut 0x1 bloc 916 gaz 46287 
RehearseArgentVault.s.sol/run-latest.json #5 registerInvoice(bytes32,bytes32,uint256) statut 0x1 bloc 917 gaz 115835 
RehearseArgentVault.s.sol/run-latest.json #6 registerInvoice(bytes32,bytes32,uint256) statut 0x1 bloc 918 gaz 98735 
RehearseArgentVault.s.sol/run-latest.json #7 fund() statut 0x1 bloc 919 gaz 22707 
RehearseArgentVault.s.sol/run-latest.json #8 submit((bytes32,bytes32,bytes32,uint8,bytes32,uint64,uint64),bytes) statut 0x1 bloc 920 gaz 127062 
RehearseArgentVault.s.sol/run-latest.json #9 submit((bytes32,bytes32,bytes32,uint8,bytes32,uint64,uint64),bytes) statut 0x1 bloc 921 gaz 192499 
RehearseArgentVault.s.sol/run-latest.json #10 refuse(bytes32) statut 0x1 bloc 922 gaz 63002 
RehearseArgentVault.s.sol/run-latest.json #11 submit((bytes32,bytes32,bytes32,uint8,bytes32,uint64,uint64),bytes) statut 0x1 bloc 923 gaz 192511 
RehearseArgentVault.s.sol/finish-latest.json #0 expire(bytes32) statut 0x1 bloc 946 gaz 63107 
RehearseArgentVault.s.sol/finish-latest.json #1 submit((bytes32,bytes32,bytes32,uint8,bytes32,uint64,uint64),bytes) statut 0x1 bloc 947 gaz 192479 
RehearseArgentVault.s.sol/finish-latest.json #2 approve(bytes32) statut 0x1 bloc 948 gaz 90650 
RehearseArgentVault.s.sol/finish-latest.json #3 submit((bytes32,bytes32,bytes32,uint8,bytes32,uint64,uint64),bytes) statut 0x1 bloc 949 gaz 41724 
RehearseArgentVault.s.sol/finish-latest.json #4 submit((bytes32,bytes32,bytes32,uint8,bytes32,uint64,uint64),bytes) statut 0x1 bloc 950 gaz 39547 
RehearseArgentVault.s.sol/finish-latest.json #5 pauseVault() statut 0x1 bloc 951 gaz 27668 
RehearseArgentVault.s.sol/finish-latest.json #6 resumeVault() statut 0x1 bloc 952 gaz 27718 
événements Decision (requestId, action, décision, motif, refId, bloc, ts) :
R1 1 2 0 0x0665d8d815dfef587a495604ca870d4b3f510bfaabe41553ad691024b8d4b49c  bloc 920 ts 1791685241
R2 1 1 10 0x6caf3d2be4cf3cd29da1a2c49da20583230f10e51e083d953fb70778efa0ce3e  bloc 921 ts 1791685243
R2 1 0 12 0x6caf3d2be4cf3cd29da1a2c49da20583230f10e51e083d953fb70778efa0ce3e  bloc 922 ts 1791685245
R3 1 1 10 0x6caf3d2be4cf3cd29da1a2c49da20583230f10e51e083d953fb70778efa0ce3e  bloc 923 ts 1791685247
R3 1 0 11 0x6caf3d2be4cf3cd29da1a2c49da20583230f10e51e083d953fb70778efa0ce3e  bloc 946 ts 1791685338
R4 1 1 10 0x6caf3d2be4cf3cd29da1a2c49da20583230f10e51e083d953fb70778efa0ce3e  bloc 947 ts 1791685340
R4 1 2 13 0x6caf3d2be4cf3cd29da1a2c49da20583230f10e51e083d953fb70778efa0ce3e  bloc 948 ts 1791685342
R1 1 0 3 0x0665d8d815dfef587a495604ca870d4b3f510bfaabe41553ad691024b8d4b49c  bloc 949 ts 1791685344
R5 1 0 4 0x0665d8d815dfef587a495604ca870d4b3f510bfaabe41553ad691024b8d4b49c  bloc 950 ts 1791685346
événements Paid (requestId, refId, montant wei) :
R1 ref 0x0665d8d815dfef587a495604ca870d4b3f510bfaabe41553ad691024b8d4b49c montant 10000000000000000
R4 ref 0x6caf3d2be4cf3cd29da1a2c49da20583230f10e51e083d953fb70778efa0ce3e montant 30000000000000000
événements HoldPlaced (requestId, montant wei, échéance) :
R2 30000000000000000 [3e16] 1791685273 [1.791e9] 
R3 30000000000000000 [3e16] 1791685277 [1.791e9] 
R4 30000000000000000 [3e16] 1791685370 [1.791e9] 
événements HoldReleased (requestId, montant wei) :
R2 30000000000000000
R3 30000000000000000
R4 30000000000000000
événements de pause : VaultPaused 1, VaultResumed 1
isConsumed : R1 true, R4 true, R5 false
factures : F-001 3, F-002 3 (3 = Settled)
solde B-001 0xD4993522a705ebC29cD3Cc5c5e4F96F475A49Ae8 : 40000000000000000 wei
cash() = 60000000000000000 [6e16]
admittedDebts() = 0
totalHeld() = 0
safetyReserve() = 40000000000000000 [4e16]
threshold() = 25000000000000000 [2.5e16]
placeable() = 20000000000000000 [2e16]
approvalDelay() = 30, vaultPaused() = false
--- Étape 6 : forge test : 330 tests, 0 échec ; ArgentVault seul : 77 tests (7 suites), 0 échec
--- Valeurs de la répétition (unité des fixtures : 1 = 10^15 wei)
cash 100, F-001 10 et F-002 30 vers B-001, seuil 25, réserve de sécurité 40, approvalDelay 30 s, TTL des demandes 300 s ; agent A-DEM-1 mandat PAY_INVOICE
ordre joué : R1 (F-001) 2/NONE ; R2 (F-002) 1/ABOVE_THRESHOLD puis refuse 0/APPROVAL_REFUSED ; R3 (F-002) 1 puis expire 0/APPROVAL_TIMEOUT ; R4 (F-002) 1 puis approve 2/APPROVED ; rejeu R1 0/REQUEST_REPLAYED ; R5 signée par la clé du relais 0/SIGNATURE_INVALID, non consommée ; pauseVault puis resumeVault
--- Adresses (L1 local :9654, chainId 191919)
ArgentVault 0xfbfbfDdd6e35dA57b7B0F9a2C10E34Be70B3A4E9 (bloc 889)
propriétaire idx10 0xBcd4042DE499D14e55001CcbB24a551F3b954096 ; admission idx11 0x71bE63f3384f5fb98995898A86B02Fb2426c5788 ; relais idx12 0xFABB0ac9d68B0B445fB7357272Ff202C5651694a
approbateur idx13 0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec ; gardien idx14 0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097 ; signataire idx15 0xcd3B766CCDd6AE721141F452C550Ca635964ce71
B-001 (sans clé connue) 0xD4993522a705ebC29cD3Cc5c5e4F96F475A49Ae8 ; non admis idx16 0x2546BcD3c84621e976D8185a91A922aE77ECEc30
```
