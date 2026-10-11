Ce que c'est : bout en bout sur le L1 AWS : passerelle, cache et trois vérificateurs, deux demandes jusqu'à la clôture relue sur la chaîne.
Commande : `RPC_URL=<RPC du L1> ADDRESSES_FILE=deployments/latest-aws.json E2E_EXPECT_CLOSED=1 bash offchain/e2e.sh`

```text
[e2e] Vérification du RPC...
[e2e] RPC OK
[e2e] Vérification du contrat marché...
[e2e] Contrat OK (29942 caractères de bytecode)
[e2e] Registre OK (0xdcc8dcdb1d46b88a3385a0b1c97d8ab6c1af5fdc)
[e2e] Fenêtres : commit=30s reveal=20s contest=60s
[e2e] EVALUATOR_TIMEOUT_MS=15000 (moitié de la fenêtre commit)
[e2e] Adresse demandeur : 0x15d34aaf54267db7d7c367839aaf71a00a2c6a65
[e2e] Vérificateur 1 actif au registre
[e2e] Vérificateur 2 actif au registre
[e2e] Vérificateur 3 actif au registre
[e2e] Cycle 1/2
[e2e] Envoi de POST /requests (montant=50000)...
[e2e] requestId = 4
[e2e] CommitteeDrawn pour requestId=4 : 1
[e2e] commitDeadline = 1791682008
[e2e] Attente du statut Contest (max 170s, sondage toutes les 5s)...
[e2e] Statut Contest atteint.
[e2e] VerdictRevealed pour requestId=4 : 3
[e2e] Attente du statut Closed (max 120s, sondage toutes les 5s)...
[e2e] Preuve de close : getRequest(4).status = 4 (Closed), lu par cast call
════════════════════════════════════════
 requestId      : 4
 code           : 2 (Accept)
 VerdictRevealed: 3
 statut final   : 4 (Closed)
════════════════════════════════════════
[e2e] Cycle 1 réussi : requestId=4 code=2 VerdictRevealed=3
[e2e] Cycle 2/2
[e2e] Envoi de POST /requests (montant=50000)...
[e2e] requestId = 5
[e2e] CommitteeDrawn pour requestId=5 : 1
[e2e] commitDeadline = 1791682109
[e2e] Attente du statut Contest (max 170s, sondage toutes les 5s)...
[e2e] Statut Contest atteint.
[e2e] VerdictRevealed pour requestId=5 : 3
[e2e] Attente du statut Closed (max 120s, sondage toutes les 5s)...
[e2e] Preuve de close : getRequest(5).status = 4 (Closed), lu par cast call
════════════════════════════════════════
 requestId      : 5
 code           : 2 (Accept)
 VerdictRevealed: 3
 statut final   : 4 (Closed)
════════════════════════════════════════
[e2e] Cycle 2 réussi : requestId=5 code=2 VerdictRevealed=3
[e2e] stakeOf vérificateur 1 : total=500000000000000000000 locked=0
[e2e] stakeOf vérificateur 2 : total=500000000000000000000 locked=0
[e2e] stakeOf vérificateur 3 : total=500000000000000000000 locked=0
E2E_EXIT=0
```
