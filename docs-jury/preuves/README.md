# Preuves

Extraits nettoyés des sorties brutes : commandes, verdicts, codes de sortie, résumés de tests, tableaux de gaz, alertes Slither. Les URL de RPC sont remplacées par `<RPC du L1>` ; les chemins locaux, adresses IP et identifiants d'infrastructure sont retirés. Les adresses EVM sont celles des comptes de test publics de Foundry.

| Fichier | Ce qu'il prouve |
|---|---|
| [scene-aws.md](scene-aws.md) | Sur le L1 AWS, la TxAllowList refuse l'intrus ; la faute 1 saisit 1 % et ajoute un strike ; la faute 3 saisit 20 % sur contestation ; l'état final se lit sur la chaîne (SCENE_EXIT=0). |
| [e2e-aws.md](e2e-aws.md) | Sur le L1 AWS, deux demandes passent de bout en bout (passerelle, cache, trois vérificateurs) jusqu'à la clôture relue par `cast call` (E2E_EXIT=0). |
| [e2e-aws-cache.md](e2e-aws-cache.md) | Même bout en bout après le stockage des détails sous leur hash : deux cycles réussis, statut Closed lu sur la chaîne. |
| [slither-marche.md](slither-marche.md) | Analyse Slither du marché : 36 alertes, toutes lues dans le rapport de sécurité. |
| [slither-vault.md](slither-vault.md) | Analyse Slither de la branche du coffre : 57 alertes, dont celles propres à ArgentVault. |
| [gas-report-marche.md](gas-report-marche.md) | Coût en gaz des fonctions du marché ; 253 tests passés au moment de la mesure. |
| [gas-report-vault.md](gas-report-vault.md) | Coût en gaz d'ArgentVault et de ses douze scénarios, tailles du bytecode sous la limite ; 330 tests passés au moment de la mesure. |
| [vault-l1-local.md](vault-l1-local.md) | ArgentVault répété sur un L1 local identique : 20 transactions, décisions 0/1/2, refus, expiration, rejeu, pause ; une adresse non admise ne peut pas appeler `fund()`. |
| [heartbeat-local.md](heartbeat-local.md) | Le battement de blocs échoue clairement sans RPC ni admission, fait avancer la chaîne pendant un e2e, s'arrête au Ctrl-C (code 0) et survit à une coupure passagère. |
| [m4-tests-red.md](m4-tests-red.md) | Avant le correctif M4, les deux tests M4 échouent : `approve` versait un placement devenu non plaçable. |
| [m4-forge-test-final.md](m4-forge-test-final.md) | Après le correctif cf9bab9, les deux tests M4 passent et la suite entière reste verte (332 tests). |
| [m4-slither-comparison.md](m4-slither-comparison.md) | Le correctif M4 n'ajoute aucune alerte Slither haute ou moyenne. |
