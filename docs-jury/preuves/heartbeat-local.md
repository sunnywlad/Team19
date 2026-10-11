Ce que c'est : battement de blocs (script/heartbeat.sh) sur un L1 local : échecs attendus, mesure de cadence, e2e en parallèle, arrêt par Ctrl-C, reprise après coupure.
Commande : `ADMIN_PRIVATE_KEY=… script/heartbeat.sh --prepare <RPC du L1> ; script/heartbeat.sh <RPC du L1> 5`

```text
### 2026-10-11T04:16:22+02:00 échecs attendus
$ heartbeat.sh <RPC mort>
ERREUR : le RPC ne répond pas (<RPC mort>).
exit=1
$ heartbeat.sh <RPC :9654> (adresse non admise)
chainId = 191919, adresse du battement = 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 (index 9)
ERREUR : 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 n'est pas admise sur la TxAllowList. Lancez une fois : ADMIN_PRIVATE_KEY=… script/heartbeat.sh --prepare <RPC>
exit=1
$ heartbeat.sh --prepare sans ADMIN_PRIVATE_KEY
chainId = 191919, adresse du battement = 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 (index 9)
ERREUR : --prepare exige ADMIN_PRIVATE_KEY (clé admin brute).
exit=1
### 2026-10-11T04:16:34+02:00 étape 1 : --prepare puis battement (5 s)
chainId = 191919, adresse du battement = 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 (index 9)
prepare : TxAllowList, rôle 0 -> setEnabled
Error: server returned an error response: error code -32000: replacement transaction underpriced
mesure : bloc 888 -> 889 en 60 s, soit 1 blocs
### 2026-10-11T04:18:49+02:00 étape 1, 2e essai (le 1er : nonce admin disputé par une autre session, essais ajoutés)
chainId = 191919, adresse du battement = 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 (index 9)
prepare : TxAllowList, rôle 0 -> setEnabled
prepare : solde < 100 VETO -> mint du complément
battement toutes les 5 s, Ctrl-C pour arrêter.
04:18:53 battement 1 : bloc 892
04:18:57 battement 2 : bloc 893
04:19:01 battement 3 : bloc 894
[… un battement toutes les 5 s, coupé …]
mesure : bloc 894 -> 906 en 60 s, soit 12 blocs
### 2026-10-11T04:20:12+02:00 étape 2 : e2e (E2E_EXPECT_CLOSED=1 E2E_REQUESTS=2), battement en marche
04:20:17 battement 18 : bloc 909
04:20:21 battement 19 : bloc 910
04:20:27 battement 20 : bloc 913
[… un battement toutes les 5 s, coupé …]
### 2026-10-11T04:22:04+02:00 étape 2, 2e lancement (le 1er, parti avant la fin de npm ci : viem absent, exit 1)
04:22:07 battement 40 : bloc 940
04:22:13 battement 41 : bloc 943
04:22:17 battement 42 : bloc 945
[… un battement toutes les 5 s, coupé …]
[e2e] Vérification du RPC...
[e2e] RPC OK
[e2e] Vérification du contrat marché...
[e2e] Contrat OK (29942 caractères de bytecode)
[e2e] Registre OK (0xd2537ac78e5e8a0cf208f0f01bf360d23099805c)
[e2e] Fenêtres : commit=30s reveal=20s contest=60s
[e2e] EVALUATOR_TIMEOUT_MS=15000 (moitié de la fenêtre commit)
[e2e] Adresse demandeur : 0x15d34aaf54267db7d7c367839aaf71a00a2c6a65
[e2e] Vérificateur 1 actif au registre
[e2e] Vérificateur 2 actif au registre
[e2e] Vérificateur 3 actif au registre
[e2e] Cycle 1/2
[e2e] Envoi de POST /requests (montant=50000)...
[e2e] requestId = 9
[e2e] CommitteeDrawn pour requestId=9 : 1
[e2e] commitDeadline = 1791685358
[e2e] Attente du statut Contest (max 170s, sondage toutes les 5s)...
[e2e] Statut Contest atteint.
[e2e] VerdictRevealed pour requestId=9 : 3
[e2e] Attente du statut Closed (max 120s, sondage toutes les 5s)...
[e2e] Preuve de close : getRequest(9).status = 4 (Closed), lu par cast call
════════════════════════════════════════
 requestId      : 9
 code           : 2 (Accept)
 VerdictRevealed: 3
 statut final   : 4 (Closed)
════════════════════════════════════════
[e2e] Cycle 1 réussi : requestId=9 code=2 VerdictRevealed=3
[e2e] Cycle 2/2
[e2e] Envoi de POST /requests (montant=50000)...
[e2e] requestId = 10
[e2e] CommitteeDrawn pour requestId=10 : 1
[e2e] commitDeadline = 1791685460
[e2e] Attente du statut Contest (max 170s, sondage toutes les 5s)...
[e2e] Statut Contest atteint.
[e2e] VerdictRevealed pour requestId=10 : 3
[e2e] Attente du statut Closed (max 120s, sondage toutes les 5s)...
[e2e] Preuve de close : getRequest(10).status = 4 (Closed), lu par cast call
════════════════════════════════════════
 requestId      : 10
 code           : 2 (Accept)
 VerdictRevealed: 3
 statut final   : 4 (Closed)
════════════════════════════════════════
[e2e] Cycle 2 réussi : requestId=10 code=2 VerdictRevealed=3
[e2e] stakeOf vérificateur 1 : total=500000000000000000000 locked=0
[e2e] stakeOf vérificateur 2 : total=500000000000000000000 locked=0
[e2e] stakeOf vérificateur 3 : total=500000000000000000000 locked=0
e2e exit=0
e2e : sortie 0, aucune ligne nonce/underpriced dans la sortie e2e ni dans le battement
### 2026-10-11T04:26:21+02:00 étape 3 : SIGINT (équivalent Ctrl-C) au battement
04:26:26 battement 92 : bloc 1010
04:26:31 battement 93 : bloc 1011
04:26:37 battement 94 : bloc 1012
[… un battement toutes les 5 s, coupé …]
après arrêt : bloc 1009 -> 1015 en 30 s
(SIGINT sans effet : lancé par & depuis un shell non interactif, SIGINT y est ignoré dès l'entrée ; arrêt par SIGTERM)
battement arrêté (105 battements envoyés).
après arrêt : bloc 1023 -> 1023 en 30 s
### 2026-10-11T04:28:24+02:00 étape 3 bis : vrai Ctrl-C (SIGINT restauré, envoyé au groupe de processus comme le fait un terminal)
chainId = 191919, adresse du battement = 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 (index 9)
battement toutes les 5 s, Ctrl-C pour arrêter.
04:28:24 battement 1 : bloc 1024
04:28:29 battement 2 : bloc 1025
04:28:35 battement 3 : bloc 1026
battement arrêté (3 battements envoyés).
code de sortie après Ctrl-C : 0
après Ctrl-C : bloc 1026 -> 1026 en 20 s
### 2026-10-11T04:29:10+02:00 erreur passagère : battement via un proxy local coupé 12 s puis relancé
chainId = 191919, adresse du battement = 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 (index 9)
battement toutes les 5 s, Ctrl-C pour arrêter.
04:29:11 battement 1 : bloc 1027
04:29:16 battement 2 : bloc 1028
04:29:21 battement 3 : bloc 1029
--- proxy coupé
04:29:26 erreur, nouvel essai au prochain battement : Error: MPP HTTP request to <RPC du L1> failed: HTTP request failed: error sending request: error sending request: client error (Connect): tcp connect error: Connection refused (os error 111)
04:29:32 erreur, nouvel essai au prochain battement : Error: MPP HTTP request to <RPC du L1> failed: HTTP request failed: error sending request: error sending request: client error (Connect): tcp connect error: Connection refused (os error 111)
--- proxy relancé
[… un battement toutes les 5 s, coupé …]
battement arrêté (6 battements envoyés).
```
