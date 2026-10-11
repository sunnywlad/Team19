# Dossier jury : la partie blockchain

> **Où se situe ce dossier.** Le marché de vérification décrit ici est une
> extension : il n'est pas sur le chemin de la démo (`make demo`,
> `make scenes`). Le coffre de la démo, `src/ArgentVault.sol`, et ce qu'il
> prouve aujourd'hui sont décrits dans le [README](../README.md) à la racine.

Ce dossier décrit la partie blockchain du projet. Il s'adresse au jury. Nous
rassemblons ici ce que la pile fait, comment elle est bâtie, et comment la
rejouer.

## Ce que fait la partie blockchain

Nous fournissons un marché de vérification pour le flux de l'équipe.
Un agent demandeur soumet une décision prévue. Un comité de
vérificateurs la juge. La chaîne agrège les verdicts en un code simple. Le code
0 signifie refusé. Le code 1 signifie validation humaine conseillée. Le code 2
signifie accepté. Le demandeur lit ce code et agit hors chaîne.

Le marché fonctionne sur notre L1 Avalanche privé sur AWS, avec le jeton
natif VETO et le guichet VetoDesk. ArgentVault porte séparément la décision
déterministe et le paiement simulé : il est écrit, testé, répété sur un L1 local identique (20 transactions, décisions 0/1/2, refus, expiration, rejeu, pause),
et pas encore déployé sur le L1 de démo. Au temps 1, il décide sans le vote du marché ;
leur jonction appartient au temps 2.

Sources : `src/VerificationMarket.sol`, `src/VetoDesk.sol`,
`infra/l1/README.md`, `src/ArgentVault.sol` ;
[preuves/scene-aws.md](preuves/scene-aws.md), [preuves/e2e-aws.md](preuves/e2e-aws.md)
et [preuves/vault-l1-local.md](preuves/vault-l1-local.md).

Nos suites comptent **332 tests Foundry** (253 pour le marché, 79 pour le coffre)
et **192 tests hors chaîne**, tous verts, mesurés par `forge test --summary` et
`npm test` dans `offchain/`. Le détail est dans [tests.md](tests.md).

## Les fichiers de ce dossier

| Fichier | Contenu |
|---|---|
| `README.md` | Ce sommaire et le résumé de la partie blockchain. |
| `architecture.md` | Le L1 privé VETO, les contrats par phase, la part hors chaîne. |
| `flux-demande.md` | Le parcours d'une demande, du dépôt au code final. |
| `fautes.md` | Les trois fautes, les sanctions, et nos limites assumées. |
| `rejouer-la-demo.md` | Les commandes pour redéployer et rejouer la scène d'attaque. |
| [mesures-gaz.md](mesures-gaz.md) | Tailles des contrats, coûts mesurés et réglages du compilateur. |
| [tests.md](tests.md) | Suites Foundry et hors chaîne, familles de tests et commandes. |
| [rapport-securite.md](rapport-securite.md) | Revue de sécurité interne : modèle de menace, garde-fous, constats et correctifs. |
| [preuves/](preuves/README.md) | Extraits des sorties de nos runs : scène d'attaque, bout en bout, Slither, gaz, coffre, battement, correctif M4. |
