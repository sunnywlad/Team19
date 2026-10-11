Ce que c'est : scène d'attaque jouée sur le L1 AWS : TxAllowList, faute 1 (1 % + strike), faute 3 (20 % sur contestation), état final lu sur la chaîne.
Commande : `ADMIN_ACCOUNT="$ADMIN_ACCOUNT" bash script/attack-scene.sh <RPC du L1>`

```text

============================================================
ÉTAPE 0 — Pile neuve (remise à zéro)
============================================================
  Déploiement complet par ./script/deploy-all.sh (fenêtres
  COMMIT=30 REVEAL=20 CONTEST=60).
  ✓ Pile déployée.

  Adresses de la pile phase 3 (deployments/latest.json) :
    DrawnVerificationMarket : 0x5a76ae5b18c17f69c169ed6fc8dd32cd0746843b
    VerifierRegistry        : 0xdcc8dcdb1d46b88a3385a0b1c97d8ab6c1af5fdc
    Slashing                : 0x10782a8b4bf76fffac917df2cc3d7c95d9c08a9a
    AgentIdentityRegistry   : 0xf944db03e1ca79cd3cf1e8e555131bdcde3e033c
    AgentReputationRegistry : 0xef14c42c63fb365acab259b146d72b8c089b7aa8
    Admin / trésor          : 0xB38451f8731010c6734B0B4fBB3430c7D65A102a
    Frais d'une demande     : 1.000000000000000000 VETO

============================================================
ÉTAPE (a) — TxAllowList : l'intrus (index 5) ne peut rien écrire
============================================================
  → Ce qu'on prouve : sur le L1, seule une adresse admise écrit ; l'intrus a le rôle 0 et sa transaction est refusée par le nœud, même avec du gaz.

  Intrus (index 5) : 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
  readAllowList(intrus) = 0  (0 = aucun droit d'écriture)

  L'admin envoie d'abord un peu de VETO à l'intrus (l'envoi VERS lui est permis)…
  Solde de l'intrus : 1.000000000000000000 VETO  (il a du gaz)

  L'intrus tente une transaction (un simple transfert de 0 vers lui-même,
  pour que SEULE la TxAllowList puisse la refuser). On attend un REFUS du nœud :
  ----- message du nœud -----
    Error: server returned an error response: error code -32000: cannot issue transaction from non-allow listed address: 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc
  ---------------------------
  ✓ Transaction refusée (code 1) : la TxAllowList bloque l'intrus en amont de l'EVM.

============================================================
ÉTAPE (b) — Faute 1 : un membre tiré ne commit pas → saisie 1 % + strike
============================================================
  → Ce qu'on prouve : un vérificateur tiré qui ne commit pas est saisi de 1 % de sa caution et prend un strike, constaté automatiquement à la finalisation.

  minStake lue sur le registre : 100.000000000000000000 VETO
  Les index 1 à 4 s'inscrivent (register) avec la caution minimale…
    index 1 (0x70997970C51812dc3A010C7d01b50e0d17dc79C8) : inscrit, caution 100.000000000000000000 VETO
    index 2 (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC) : inscrit, caution 100.000000000000000000 VETO
    index 3 (0x90F79bf6EB2c4f870365E785982E1f101E93b906) : inscrit, caution 100.000000000000000000 VETO
    index 4 (0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65) : inscrit, caution 100.000000000000000000 VETO

  Demandeur : index 4 (0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65) — exclu du tirage, laisse {1,2,3} éligibles.
  h(b) = hashOf(facts, contentHash) = 0xc970e1457852b2f339e1d7cd1350e8c6327cc165228447bed8addceaaf651a3a
  Demande créée : requestId = 1
  Tirage du comité (on mine des blocs vides jusqu'à block.number > drawBlock)…
  Comité tiré : 0x90F79bf6EB2c4f870365E785982E1f101E93b906  0x70997970C51812dc3A010C7d01b50e0d17dc79C8  0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
  Membre ABSENT (ne commit pas) : 0x90F79bf6EB2c4f870365E785982E1f101E93b906
  Membres PRÉSENTS (commit + reveal) : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8  0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
  Caution de l'absent AVANT : 100.000000000000000000 VETO  | strikes AVANT : 0
  finalize(1) — constate l'absent et déclenche slashMissed(1 %)…
  Caution de l'absent APRÈS : 99.000000000000000000 VETO  | strikes APRÈS : 1
  Saisie : 1.000000000000000000 VETO  (soit 1.0% de la caution)
  ✓ Faute 1 prouvée : 1 % saisi, +1 strike.

============================================================
ÉTAPE (c) — Faute 3 : vote Accept au-dessus du plafond → contestation, saisie 20 %
============================================================
  → Ce qu'on prouve : un vérificateur qui vote Accept alors que le montant dépasse le plafond, sans cocher le motif amount_above_cap, est saisi de 20 % sur contestation.

  Recomplément des cautions redescendues sous minStake (faute 1 oblige)…
    index 3 : recomplété de 101.000000000000000000 VETO (était sous minStake)
  L'admin fixe Slashing.setCap('EUR', 500)…
  cap('EUR') lu sur la chaîne = 500
  Demande (c) : montant 1000 > plafond 500 ; h(c) = 0x629c88f7a7b56fc531f53d1aec7c665e2d948051ce92d78d2b104b287deba5e4
  requestId = 2
  Comité tiré : 0x90F79bf6EB2c4f870365E785982E1f101E93b906  0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC  0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  Vérificateur FAUTIF (vote Accept=2, reasons=0 alors que montant>plafond) : 0x90F79bf6EB2c4f870365E785982E1f101E93b906
  Les deux autres votent Accept également (le comité ne voit pas le plafond).
  finalize(2)…
  Caution du fautif AVANT contestation : 200.000000000000000000 VETO
  contest(2, fautif, facts, contentHash) — par l'admin, pendant la fenêtre de contestation…
  ----- événements émis par la contestation -----
    ContestOpened    blockNumber: 59
    ContestOpened    data: 0x
    VerifierSlashed   blockNumber: 59
    VerifierSlashed   data: 0x00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000022b1c8c1227a00000
    ContestResolved   blockNumber: 59
    ContestResolved   data: 0x0000000000000000000000000000000000000000000000000000000000000001
  -----------------------------------------------
  Caution du fautif APRÈS : 160.000000000000000000 VETO
  Saisie : 40.000000000000000000 VETO  (soit 20.0% de la caution)
  ✓ Faute 3 prouvée : 20 % saisi sur contestation.

============================================================
ÉTAPE réputation — identités ERC-8004 + une demande propre pour alimenter la réputation
============================================================
  → Ce qu'on prouve : le marché dépose un retour de réputation (+1 pour un reveal) sur chaque membre tiré ayant une identité ERC-8004, via giveFeedback, sans jamais pouvoir bloquer finalize.

  Recomplément des cautions sous minStake (après la saisie de 20 %)…
  Enregistrement d'une identité ERC-8004 pour les index 1-4 (register())…
    index 1 (0x70997970C51812dc3A010C7d01b50e0d17dc79C8) : identité agentId=1
    index 2 (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC) : identité agentId=2
    index 3 (0x90F79bf6EB2c4f870365E785982E1f101E93b906) : identité agentId=3
    index 4 (0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65) : identité agentId=4
  Demande d'alimentation : requestId = 3
  Comité tiré : 0x70997970C51812dc3A010C7d01b50e0d17dc79C8  0x90F79bf6EB2c4f870365E785982E1f101E93b906  0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
  ✓ Demande 3 finalisée : réputation déposée pour les membres ayant une identité.

============================================================
ÉTAPE (d) — Lecture finale sur la chaîne
============================================================
  → Ce qu'on prouve : tout l'état sanctionnateur est lisible sur la chaîne : cautions, strikes, réputation ERC-8004, et le code final de chaque demande.

  — Cautions et strikes des index 1-4 —
    index 1 (0x70997970C51812dc3A010C7d01b50e0d17dc79C8) : caution 100.000000000000000000 VETO (bloqué 60.000000000000000000 VETO) | strikes 0
    index 2 (0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC) : caution 100.000000000000000000 VETO (bloqué 60.000000000000000000 VETO) | strikes 0
    index 3 (0x90F79bf6EB2c4f870365E785982E1f101E93b906) : caution 160.000000000000000000 VETO (bloqué 51.000000000000000000 VETO) | strikes 1
    index 4 (0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65) : caution 100.000000000000000000 VETO (bloqué 0.000000000000000000 VETO) | strikes 0

  — Réputation ERC-8004 (le marché est le client ; getSummary tag 'reveal') —
    index 1 (agentId=1) : 1 retour(s) 'reveal', score cumulé = 1
    index 2 (agentId=2) : 1 retour(s) 'reveal', score cumulé = 1
    index 3 (agentId=3) : 1 retour(s) 'reveal', score cumulé = 1
    index 4 (agentId=4) : 0 retour(s) 'reveal', score cumulé = 0

  — Code final de chaque demande (0=Refuse, 1=HumanReview, 2=Accept) —
    demande 1 : statut Contest | code Accept
    demande 2 : statut Contest | code Accept
    demande 3 : statut Contest | code Accept

============================================================
SCÈNE TERMINÉE — tous les garde-fous prouvés sur la chaîne
============================================================
  Durée du run : 271s
  (a) TxAllowList : intrus refusé.  (b) Faute 1 : 1 % + strike.
  (c) Faute 3 : 20 % sur contestation.  (d) état final lu sur la chaîne.
SCENE_EXIT=0
```
